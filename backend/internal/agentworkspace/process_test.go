package agentworkspace

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fullAccessTestRoot(t *testing.T) string {
	t.Helper()
	parent := os.Getenv("SEAL_WORKSPACE_TEST_ROOT")
	if parent == "" {
		return t.TempDir()
	}
	parent, err := filepath.Abs(parent)
	if err != nil {
		t.Fatal(err)
	}
	root, err := os.MkdirTemp(parent, "full-access-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if filepath.Dir(root) != parent {
			t.Fatal("invalid test cleanup root")
		}
		if err := os.RemoveAll(root); err != nil {
			t.Error(err)
		}
	})
	return root
}

func TestWorkspaceFullAccessFilesNetworkAndCleanEnvironment(t *testing.T) {
	node := os.Getenv("SEAL_SANDBOX_TEST_NODE")
	if node == "" {
		t.Skip("set SEAL_SANDBOX_TEST_NODE")
	}
	t.Setenv("SECRET", "synthetic-only")
	t.Setenv("BEEFTV_AGENT_HOST_TOKEN", "synthetic-only")
	t.Setenv("OPENAI_API_KEY", "synthetic-only")
	t.Setenv("NODE_OPTIONS", "--require=never-load-host-hooks")
	base := fullAccessTestRoot(t)
	m := New(filepath.Join(base, "runtime"))
	defer m.Close()
	w, err := m.Workspace("owner", "project")
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(base, "outside.txt")
	if err := os.WriteFile(outside, []byte("synthetic-input"), 0600); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("synthetic-network")) }))
	defer server.Close()
	code := `const fs=require('node:fs');(async()=>{if(fs.readFileSync(process.argv[2],'utf8')!=='synthetic-input')throw Error('read');fs.writeFileSync(process.argv[2],'synthetic-output');if(await(await fetch(process.argv[3])).text()!=='synthetic-network')throw Error('network');for(const k of ['SECRET','BEEFTV_AGENT_HOST_TOKEN','OPENAI_API_KEY','NODE_OPTIONS'])if(process.env[k])throw Error('env');console.log(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(4)}))})().catch(e=>{console.error(e);process.exitCode=1})`
	if _, err := w.Files(FilesRequest{Action: "write", Path: "run.js", Text: code}); err != nil {
		t.Fatal(err)
	}
	request := RunRequest{Runtime: "node", Script: "run.js", Args: []string{outside, server.URL, "$(literal)", "a b"}, OperationID: strings.Repeat("1", 64)}
	result, err := m.Run(t.Context(), w, request, node, "")
	if err != nil || result.ExitCode != 0 || result.State != "completed" {
		t.Fatalf("result=%+v err=%v", result, err)
	}
	var output struct {
		CWD  string   `json:"cwd"`
		Args []string `json:"args"`
	}
	if err := json.Unmarshal([]byte(strings.TrimSpace(result.Output)), &output); err != nil || output.CWD != w.Root || strings.Join(output.Args, "|") != "$(literal)|a b" {
		t.Fatalf("output=%s err=%v", result.Output, err)
	}
	if data, err := os.ReadFile(outside); err != nil || string(data) != "synthetic-output" {
		t.Fatal("external synthetic file was not writable", err)
	}
	second, err := m.Run(t.Context(), w, request, node, "")
	if err != nil || !second.Reused {
		t.Fatal("receipt replay executed again", err)
	}
	status := Status(node, "")
	if status["sandbox"] != false || status["executionMode"] != "full-access" || status["scope"] != "current-os-user" {
		t.Fatal("incorrect permission projection", status)
	}
}

func TestWorkspaceFullAccessStopsProcessTree(t *testing.T) {
	node := os.Getenv("SEAL_SANDBOX_TEST_NODE")
	if node == "" {
		t.Skip("set SEAL_SANDBOX_TEST_NODE")
	}
	for index, action := range []string{"cancel", "timeout", "close", "exit"} {
		t.Run(action, func(t *testing.T) {
			m := New(fullAccessTestRoot(t))
			defer m.Close()
			w, _ := m.Workspace("owner", "project")
			code := `const fs=require('node:fs');const cp=require('node:child_process');cp.spawn(process.execPath,['-e',"setTimeout(()=>require('node:fs').writeFileSync('late.txt','unexpected'),1800)"],{stdio:'ignore',windowsHide:true});fs.writeFileSync('ready.txt','ready');` + map[string]string{"exit": "process.exit(0)", "cancel": "setTimeout(()=>{},10000)", "timeout": "setTimeout(()=>{},10000)", "close": "setTimeout(()=>{},10000)"}[action]
			if _, err := w.Files(FilesRequest{Action: "write", Path: "run.js", Text: code}); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			done := make(chan *RunResult, 1)
			go func() {
				result, err := m.Run(ctx, w, RunRequest{Runtime: "node", Script: "run.js", TimeoutSeconds: 1, OperationID: strings.Repeat(string(rune('a'+index)), 64)}, node, "")
				if err != nil {
					done <- nil
				} else {
					done <- result
				}
			}()
			deadline := time.Now().Add(5 * time.Second)
			for {
				if _, err := os.Stat(filepath.Join(w.Root, "ready.txt")); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("script did not start")
				}
				time.Sleep(10 * time.Millisecond)
			}
			if action == "cancel" {
				cancel()
			}
			if action == "close" {
				m.Close()
			}
			select {
			case result := <-done:
				if result == nil || (action == "exit" && result.State != "completed") || (action != "exit" && result.State != "stopped") {
					t.Fatalf("result=%+v", result)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("execution did not settle")
			}
			time.Sleep(1900 * time.Millisecond)
			if _, err := os.Stat(filepath.Join(w.Root, "late.txt")); !os.IsNotExist(err) {
				t.Fatal("child survived", err)
			}
		})
	}
}
