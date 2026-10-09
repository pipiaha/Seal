package agentworkspace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWorkspacePathsVersionsAndIsolation(t *testing.T) {
	m := New(t.TempDir())
	defer m.Close()
	w, err := m.Workspace("owner", "project")
	if err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{"../private", "C:/private", "x:stream", "/absolute", "a/../b", "NUL.txt", "file.", "file "} {
		if _, err := w.Files(FilesRequest{Action: "write", Path: p, Text: "bad"}); err == nil {
			t.Fatalf("accepted %s", p)
		}
	}
	first, err := w.Files(FilesRequest{Action: "write", Path: "notes/test.txt", Text: "original"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = w.Files(FilesRequest{Action: "write", Path: "notes/test.txt", Text: "changed"}); err == nil {
		t.Fatal("overwrite without read accepted")
	}
	if _, err = w.Files(FilesRequest{Action: "write", Path: "notes/test.txt", Text: "changed", ExpectedHash: first.(map[string]any)["hash"].(string)}); err != nil {
		t.Fatal(err)
	}
	other, _ := m.Workspace("other", "project")
	if _, err := other.Files(FilesRequest{Action: "read", Path: "notes/test.txt"}); !os.IsNotExist(err) {
		t.Fatal("cross user workspace leaked", err)
	}
	if _, err = w.Copy("material.txt", strings.NewReader("123456"), 3); err == nil {
		t.Fatal("copy limit ignored")
	}
	if _, err = os.Stat(filepath.Join(w.Root, "material.txt")); !os.IsNotExist(err) {
		t.Fatal("partial copy retained")
	}
	if _, err = w.Files(FilesRequest{Action: "remove", Path: "."}); err == nil {
		t.Fatal("root removed")
	}
}

func TestWorkspaceScriptReceiptsAndPython(t *testing.T) {
	node := os.Getenv("SEAL_SANDBOX_TEST_NODE")
	if node == "" {
		t.Skip("set SEAL_SANDBOX_TEST_NODE")
	}
	m := New(t.TempDir())
	defer m.Close()
	w, _ := m.Workspace("owner", "project")
	_, err := w.Files(FilesRequest{Action: "write", Path: "run.js", Text: `const fs=require('fs');fs.writeFileSync('output/result.txt','once');console.log('success')`})
	if err != nil {
		t.Fatal(err)
	}
	request := RunRequest{Runtime: "node", Script: "run.js", OperationID: strings.Repeat("a", 64)}
	first, err := m.Run(t.Context(), w, request, node, "")
	if err != nil || first.ExitCode != 0 {
		t.Fatalf("run %+v %v", first, err)
	}
	second, err := m.Run(t.Context(), w, request, node, "")
	if err != nil || !second.Reused {
		t.Fatal("execution repeated", err)
	}
	request.Args = []string{"different"}
	if _, err = m.Run(t.Context(), w, request, node, ""); err == nil {
		t.Fatal("id reused for different invocation")
	}
	records, err := w.Runs()
	if err != nil || len(records.([]RunResult)) != 1 {
		t.Fatal("receipt missing", err)
	}
	python := os.Getenv("SEAL_SANDBOX_TEST_PYTHON")
	if python == "" {
		return
	}
	_, err = w.Files(FilesRequest{Action: "write", Path: "run.py", Text: "import os\nopen('output/python.txt','w').write('ok')\nassert not os.getenv('SECRET')\nprint('python-ok')\n"})
	if err != nil {
		t.Fatal(err)
	}
	py, err := m.Run(t.Context(), w, RunRequest{Runtime: "python", Script: "run.py", OperationID: strings.Repeat("b", 64)}, node, python)
	if err != nil || py.ExitCode != 0 {
		t.Fatalf("python %+v %v", py, err)
	}
}

func TestWorkspaceProjectDependencies(t *testing.T) {
	if os.Getenv("SEAL_SANDBOX_TEST_INSTALL") != "1" {
		t.Skip("opt-in public npm/PyPI smoke test")
	}
	node, python := os.Getenv("SEAL_SANDBOX_TEST_NODE"), os.Getenv("SEAL_SANDBOX_TEST_PYTHON")
	m := New(t.TempDir())
	defer m.Close()
	w, _ := m.Workspace("owner", "dependencies")
	for _, test := range []struct {
		kind     string
		packages []string
		id       string
	}{{"node", []string{"picocolors@1.1.1"}, strings.Repeat("c", 64)}, {"python", []string{"colorama==0.4.6"}, strings.Repeat("d", 64)}} {
		r, err := m.Install(t.Context(), w, test.kind, test.packages, test.id, node, python)
		if err != nil || r.ExitCode != 0 {
			t.Fatalf("%s result=%+v err=%v", test.kind, r, err)
		}
	}
	for _, test := range []struct{ kind, file, code, id string }{{"node", "verify.js", `console.log(require('picocolors').isColorSupported)`, strings.Repeat("e", 64)}, {"python", "verify.py", "import colorama\nprint(colorama.__version__)\n", strings.Repeat("f", 64)}} {
		if _, err := w.Files(FilesRequest{Action: "write", Path: test.file, Text: test.code}); err != nil {
			t.Fatal(err)
		}
		r, err := m.Run(t.Context(), w, RunRequest{Runtime: test.kind, Script: test.file, OperationID: test.id}, node, python)
		if err != nil || r.ExitCode != 0 {
			t.Fatalf("%s verification=%+v err=%v", test.kind, r, err)
		}
	}
}
