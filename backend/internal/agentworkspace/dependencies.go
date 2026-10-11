package agentworkspace

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

var npmPackage = regexp.MustCompile(`^(?:@[a-z0-9._-]+/)?[a-z0-9][a-z0-9._-]*(?:@[a-zA-Z0-9.+_-]+)?$`)
var pipPackage = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._-]*(?:==[a-zA-Z0-9.+_-]+)?$`)

// Installers use the same full-access runner and cancellation as Skill scripts.
// These helpers target project dependencies and do not forward application keys.
func (m *Manager) Install(ctx context.Context, w *Workspace, kind string, packages []string, id, node, python string) (*RunResult, error) {
	if !operation.MatchString(id) || len(packages) == 0 || len(packages) > 16 {
		return nil, errors.New("package_request_invalid")
	}
	pattern := npmPackage
	if kind == "python" {
		pattern = pipPackage
	} else if kind != "node" {
		return nil, errors.New("runtime_invalid")
	}
	for _, name := range packages {
		if len(name) > 160 || !pattern.MatchString(name) {
			return nil, errors.New("package_name_invalid")
		}
	}
	encoded, _ := json.Marshal(packages)
	var code string
	relative := ".seal/install-" + id + ".js"
	if kind == "node" {
		executable, err := runtimeExecutable(node)
		if err != nil {
			return nil, err
		}
		cli := filepath.Join(filepath.Dir(executable), "node_modules", "npm", "bin", "npm-cli.js")
		if _, err = os.Stat(cli); err != nil {
			return nil, errors.New("npm_not_bundled")
		}
		cliJSON, _ := json.Marshal(cli)
		code = fmt.Sprintf(`const cp=require('node:child_process');const r=cp.spawnSync(process.execPath,[%s,'install','--prefix',process.cwd(),'--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org',...%s],{stdio:'inherit',env:{...process.env,npm_config_userconfig:require('node:path').join(process.cwd(),'.seal','empty.npmrc')}});if(r.error)throw r.error;process.exit(r.status??1);`, cliJSON, encoded)
	} else {
		relative = ".seal/install-" + id + ".py"
		code = `import os,sys,subprocess,venv,json
root=os.getcwd()
envdir=os.path.join(root,'.venv')
exe=os.path.join(envdir,'Scripts','python.exe') if os.name=='nt' else os.path.join(envdir,'bin','python')
if not os.path.exists(exe):
    venv.EnvBuilder(with_pip=True,symlinks=False).create(envdir)
env=dict(os.environ)
env['PIP_CONFIG_FILE']=os.devnull
subprocess.run([exe,'-m','pip','install','--disable-pip-version-check','--timeout','10','--retries','1','--index-url','https://pypi.org/simple',*json.loads(` + fmt.Sprintf("%q", string(encoded)) + `)],env=env,check=True)
`
	}
	// Generated install scripts are also inspectable workspace files. A previous
	// copy must match exactly before the same operation can reuse its receipt.
	result, err := w.Files(FilesRequest{Action: "read", Path: relative})
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		if result.(map[string]any)["text"] != code {
			return nil, errors.New("operation_conflict")
		}
	} else {
		if _, err = w.Files(FilesRequest{Action: "write", Path: relative, Text: code}); err != nil {
			return nil, err
		}
	}
	run := RunRequest{Runtime: kind, Script: relative, OperationID: id, TimeoutSeconds: 120}
	if kind == "python" {
		run.Args = []string{}
	}
	return m.Run(ctx, w, run, node, python)
}
