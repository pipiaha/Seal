//go:build windows

package agentworkspace

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAppContainerIsolation(t *testing.T) {
	t.Setenv("SECRET", "synthetic-host-secret")
	t.Setenv("BEEFTV_AGENT_HOST_TOKEN", "synthetic-host-token")
	node := os.Getenv("SEAL_SANDBOX_TEST_NODE")
	if node == "" {
		t.Skip("set SEAL_SANDBOX_TEST_NODE to a dedicated Node distribution")
	}
	base := t.TempDir()
	root := filepath.Join(base, "work")
	os.MkdirAll(root, 0700)
	outside := filepath.Join(base, "private.txt")
	os.WriteFile(outside, []byte("private"), 0600)
	code := `const fs=require('fs');fs.writeFileSync('result.txt','ok');for(const op of [()=>fs.readFileSync(process.argv[1]),()=>fs.writeFileSync(process.argv[1],'bad'),()=>fs.writeFileSync(process.execPath,'bad')]){try{op();throw Error('ESCAPED')}catch(e){if(e.message==='ESCAPED')throw e;}}if(process.env.BEEFTV_AGENT_HOST_TOKEN)throw Error('TOKEN LEAK');console.log('isolated',process.env.SECRET||'no-secret');`
	var out bytes.Buffer
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	exit, err := runSandbox(ctx, root, node, []string{"-e", code, outside}, []string{"SystemRoot=" + os.Getenv("SystemRoot"), "TEMP=" + root, "TMP=" + root}, &out)
	if err != nil || exit != 0 {
		t.Fatalf("exit=%d err=%v output=%s", exit, err, out.String())
	}
	if !bytes.Contains(out.Bytes(), []byte("isolated no-secret")) {
		t.Fatalf("output=%s", out.String())
	}
	body, _ := os.ReadFile(outside)
	if string(body) != "private" {
		t.Fatal("outside write escaped")
	}
}

func TestAppContainerBlocksHostLoopback(t *testing.T) {
	node := os.Getenv("SEAL_SANDBOX_TEST_NODE")
	if node == "" {
		t.Skip("set SEAL_SANDBOX_TEST_NODE")
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("private")) }))
	defer server.Close()
	var out bytes.Buffer
	code := `fetch(process.argv[1],{signal:AbortSignal.timeout(1000)}).then(()=>{console.error('ESCAPED');process.exitCode=1}).catch(()=>console.log('loopback-denied'))`
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	exit, err := runSandbox(ctx, t.TempDir(), node, []string{"-e", code, server.URL}, []string{"SystemRoot=" + os.Getenv("SystemRoot")}, &out)
	if err != nil || exit != 0 || !bytes.Contains(out.Bytes(), []byte("loopback-denied")) {
		t.Fatalf("exit=%d err=%v output=%s", exit, err, out.String())
	}
}

func TestAppContainerCancellationKillsChildren(t *testing.T) {
	node := os.Getenv("SEAL_SANDBOX_TEST_NODE")
	if node == "" {
		t.Skip("set SEAL_SANDBOX_TEST_NODE")
	}
	root := t.TempDir()
	var out bytes.Buffer
	ctx, cancel := context.WithTimeout(t.Context(), 1200*time.Millisecond)
	defer cancel()
	code := `require('child_process').spawn(process.execPath,['-e',"setTimeout(()=>require('fs').writeFileSync('escaped.txt','bad'),2000)"],{stdio:'ignore'});setInterval(()=>{},1000)`
	_, err := runSandbox(ctx, root, node, []string{"-e", code}, []string{"SystemRoot=" + os.Getenv("SystemRoot"), "TEMP=" + root}, &out)
	if err != context.DeadlineExceeded {
		t.Fatalf("err=%v output=%s", err, out.String())
	}
	time.Sleep(1500 * time.Millisecond)
	if _, err := os.Stat(filepath.Join(root, "escaped.txt")); !os.IsNotExist(err) {
		t.Fatal("child survived cancellation")
	}
}
