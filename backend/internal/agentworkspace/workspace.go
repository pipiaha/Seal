package agentworkspace

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const maxText = 512 << 10

var device = regexp.MustCompile(`(?i)^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)`)
var operation = regexp.MustCompile(`^[a-f0-9]{64}$`)

type FilesRequest struct {
	Action       string `json:"action"`
	Path         string `json:"path"`
	Text         string `json:"text"`
	ExpectedHash string `json:"expectedHash"`
	Query        string `json:"query"`
	Offset       int    `json:"offset"`
}
type RunRequest struct {
	Runtime        string   `json:"runtime"`
	Script         string   `json:"script"`
	Args           []string `json:"args"`
	TimeoutSeconds int      `json:"timeoutSeconds"`
	OperationID    string   `json:"operationId"`
}
type RunResult struct {
	ExitCode    int    `json:"exitCode"`
	Output      string `json:"output"`
	Truncated   bool   `json:"truncated"`
	State       string `json:"state"`
	OperationID string `json:"operationId"`
	Reused      bool   `json:"reused,omitempty"`
}
type Workspace struct {
	Root string
	mu   sync.Mutex
}
type Manager struct {
	base   string
	mu     sync.Mutex
	roots  map[string]*Workspace
	cancel context.CancelFunc
	ctx    context.Context
}

func New(base string) *Manager {
	ctx, cancel := context.WithCancel(context.Background())
	return &Manager{base: base, roots: map[string]*Workspace{}, ctx: ctx, cancel: cancel}
}
func (m *Manager) Close()       { m.cancel() }
func digest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func (m *Manager) Workspace(user, project string) (*Workspace, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	key := digest([]byte(user + "\x00" + project))
	if w := m.roots[key]; w != nil {
		return w, nil
	}
	root := filepath.Join(m.base, "projects", key, "work")
	if err := os.MkdirAll(root, 0700); err != nil {
		return nil, err
	}
	root, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	w := &Workspace{Root: root}
	m.roots[key] = w
	return w, nil
}

// Deny junctions, links, alternate data streams and Windows device paths at
// every component, including writes to nonexistent leaves. Scripts run under
// the same workspace lock; they cannot race host file operations.
func (w *Workspace) path(relative string) (string, error) {
	rootInfo, err := os.Lstat(w.Root)
	if err != nil || isLink(rootInfo) || !rootInfo.IsDir() {
		return "", errors.New("workspace_root_invalid")
	}
	if relative == "" || relative == "." {
		return w.Root, nil
	}
	if len(relative) > 2048 || strings.Contains(relative, "\\") || filepath.IsAbs(relative) {
		return "", errors.New("workspace_path_invalid")
	}
	current := w.Root
	for _, part := range strings.Split(relative, "/") {
		if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "<>:\"|?*\x00") || strings.HasSuffix(part, ".") || strings.HasSuffix(part, " ") || device.MatchString(part) {
			return "", errors.New("workspace_path_invalid")
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil && !os.IsNotExist(err) {
			return "", err
		}
		if err == nil && isLink(info) {
			return "", errors.New("workspace_link_denied")
		}
	}
	return current, nil
}
func fileHash(file string) (string, error) {
	f, err := os.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err = io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func (w *Workspace) Files(r FilesRequest) (any, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	file, err := w.path(r.Path)
	if err != nil {
		return nil, err
	}
	switch r.Action {
	case "list":
		entries, err := os.ReadDir(file)
		if err != nil {
			return nil, err
		}
		out := []map[string]any{}
		for i, e := range entries {
			if i >= 256 {
				break
			}
			info, err := e.Info()
			if err != nil {
				return nil, err
			}
			out = append(out, map[string]any{"name": e.Name(), "directory": e.IsDir(), "size": info.Size(), "link": isLink(info)})
		}
		return map[string]any{"entries": out, "truncated": len(entries) > 256}, nil
	case "read":
		f, err := os.Open(file)
		if err != nil {
			return nil, err
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			return nil, errors.New("text_file_required")
		}
		if r.Offset < 0 || int64(r.Offset) > info.Size() {
			return nil, errors.New("offset_invalid")
		}
		f.Seek(int64(r.Offset), io.SeekStart)
		body, err := io.ReadAll(io.LimitReader(f, maxText+1))
		if err != nil {
			return nil, err
		}
		more := len(body) > maxText
		if more {
			body = body[:maxText]
		}
		for trim := 0; trim < 3 && len(body) > 0 && more && !utf8.Valid(body); trim++ {
			body = body[:len(body)-1]
		}
		if !utf8.Valid(body) {
			return nil, errors.New("utf8_text_required")
		}
		hash, err := fileHash(file)
		if err != nil {
			return nil, err
		}
		return map[string]any{"text": string(body), "hash": hash, "nextOffset": r.Offset + len(body), "truncated": more, "size": info.Size()}, nil
	case "write":
		if file == w.Root || len(r.Text) > maxText || !utf8.ValidString(r.Text) {
			return nil, errors.New("text_write_invalid")
		}
		hash, err := fileHash(file)
		if err == nil && r.ExpectedHash != hash {
			return nil, errors.New("workspace_version_conflict")
		}
		if err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		if os.IsNotExist(err) && r.ExpectedHash != "" {
			return nil, errors.New("workspace_version_conflict")
		}
		if err = os.MkdirAll(filepath.Dir(file), 0700); err != nil {
			return nil, err
		}
		if err = os.WriteFile(file, []byte(r.Text), 0600); err != nil {
			return nil, err
		}
		return map[string]any{"path": r.Path, "hash": digest([]byte(r.Text))}, nil
	case "mkdir":
		if err = os.MkdirAll(file, 0700); err != nil {
			return nil, err
		}
		return map[string]any{"path": r.Path}, nil
	case "remove":
		if file == w.Root {
			return nil, errors.New("workspace_root_protected")
		}
		info, err := os.Stat(file)
		if err != nil {
			return nil, err
		}
		if !info.IsDir() {
			hash, err := fileHash(file)
			if err != nil {
				return nil, err
			}
			if hash != r.ExpectedHash {
				return nil, errors.New("workspace_version_conflict")
			}
		}
		return map[string]any{"path": r.Path}, os.Remove(file) // directories must be empty
	case "search":
		if r.Query == "" || len(r.Query) > 256 {
			return nil, errors.New("search_query_invalid")
		}
		hits := []map[string]any{}
		visited := 0
		err = filepath.WalkDir(file, func(p string, d fs.DirEntry, e error) error {
			if e != nil {
				return e
			}
			visited++
			if visited > 4000 || len(hits) >= 100 {
				return fs.SkipAll
			}
			info, e := d.Info()
			if e != nil {
				return e
			}
			if isLink(info) {
				if d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				if d.Name() == "node_modules" || d.Name() == ".venv" {
					return fs.SkipDir
				}
				return nil
			}
			if !info.Mode().IsRegular() || info.Size() > maxText {
				return nil
			}
			body, e := os.ReadFile(p)
			if e != nil {
				return e
			}
			if !utf8.Valid(body) {
				return nil
			}
			for i, line := range strings.Split(string(body), "\n") {
				if strings.Contains(strings.ToLower(line), strings.ToLower(r.Query)) {
					rel, _ := filepath.Rel(w.Root, p)
					if len(line) > 500 {
						line = line[:500]
					}
					hits = append(hits, map[string]any{"path": filepath.ToSlash(rel), "line": i + 1, "text": line})
					if len(hits) >= 100 {
						break
					}
				}
			}
			return nil
		})
		return map[string]any{"matches": hits, "truncated": visited > 4000 || len(hits) >= 100}, err
	default:
		return nil, errors.New("workspace_action_invalid")
	}
}

func (w *Workspace) Copy(relative string, src io.Reader, limit int64) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	file, err := w.path(relative)
	if err != nil {
		return "", err
	}
	if file == w.Root {
		return "", errors.New("file_required")
	}
	if err = os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return "", err
	}
	f, err := os.OpenFile(file, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	n, e := io.Copy(f, io.LimitReader(src, limit+1))
	closeErr := f.Close()
	if e != nil || closeErr != nil || n > limit {
		os.Remove(file)
		return "", errors.New("workspace_copy_failed_or_too_large")
	}
	return fileHash(file)
}

func (w *Workspace) ReadArtifact(relative string, consume func(*os.File) error) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	file, err := w.path(relative)
	if err != nil {
		return err
	}
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() {
		return errors.New("artifact_file_required")
	}
	return consume(f)
}

func (w *Workspace) CopySkill(name, hash, src string) (string, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	relative := "skills/" + name + "/" + hash
	dest, err := w.path(relative)
	if err != nil {
		return "", err
	}
	// A previous workspace copy can be modified by a script: always replace its
	// files from the canonical enabled package before each explicit copy request.
	count := 0
	total := int64(0)
	err = filepath.WalkDir(src, func(file string, d fs.DirEntry, e error) error {
		if e != nil {
			return e
		}
		count++
		if count > 2000 {
			return errors.New("skill_too_large")
		}
		info, e := d.Info()
		if e != nil {
			return e
		}
		if isLink(info) {
			return errors.New("skill_link_denied")
		}
		rel, _ := filepath.Rel(src, file)
		target := dest
		if rel != "." {
			target, e = w.path(relative + "/" + filepath.ToSlash(rel))
			if e != nil {
				return e
			}
		}
		if d.IsDir() {
			return os.MkdirAll(target, 0700)
		}
		if !info.Mode().IsRegular() {
			return errors.New("skill_file_invalid")
		}
		total += info.Size()
		if info.Size() > 8<<20 || total > 64<<20 {
			return errors.New("skill_too_large")
		}
		body, e := os.ReadFile(file)
		if e != nil {
			return e
		}
		return os.WriteFile(target, body, 0600)
	})
	return relative, err
}

type boundedOutput struct {
	body      []byte
	truncated bool
}

func (b *boundedOutput) Write(p []byte) (int, error) {
	n := len(p)
	available := 64<<10 - len(b.body)
	if available > 0 {
		take := n
		if take > available {
			take = available
		}
		b.body = append(b.body, p[:take]...)
	}
	if n > available {
		b.truncated = true
	}
	return n, nil
}

func (m *Manager) Run(ctx context.Context, w *Workspace, r RunRequest, node, python string) (*RunResult, error) {
	if m.ctx.Err() != nil {
		return nil, errors.New("workspace_runtime_closed")
	}
	if !operation.MatchString(r.OperationID) || len(r.Args) > 64 {
		return nil, errors.New("run_request_invalid")
	}
	for _, arg := range r.Args {
		if len(arg) > 4096 || strings.ContainsRune(arg, 0) {
			return nil, errors.New("run_argument_invalid")
		}
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	script, err := w.path(r.Script)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(script)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("script_file_required")
	}
	if r.Runtime != "node" && r.Runtime != "python" {
		return nil, errors.New("runtime_invalid")
	}
	exe := node
	if r.Runtime == "python" {
		exe = python
	}
	if exe == "" {
		return nil, errors.New("runtime_not_installed")
	}
	exe, err = runtimeExecutable(exe)
	if err != nil {
		return nil, err
	}
	if r.Runtime == "python" {
		venvPath := ".venv/bin/python"
		if runtime.GOOS == "windows" {
			venvPath = ".venv/Scripts/python.exe"
		}
		venv, e := w.path(venvPath)
		if e != nil {
			return nil, e
		}
		if i, e := os.Stat(venv); e == nil && i.Mode().IsRegular() {
			exe = venv
		}
	}
	hash, err := fileHash(script)
	if err != nil {
		return nil, err
	}
	fingerprint, _ := json.Marshal([]any{r.Runtime, r.Script, hash, r.Args, r.TimeoutSeconds})
	requestHash := digest(fingerprint)
	receipts := filepath.Join(filepath.Dir(w.Root), "receipts")
	if err = os.MkdirAll(receipts, 0700); err != nil {
		return nil, err
	}
	receipt := filepath.Join(receipts, r.OperationID+".json")
	type record struct {
		Hash   string
		Result RunResult
	}
	if body, e := os.ReadFile(receipt); e == nil {
		var saved record
		if json.Unmarshal(body, &saved) != nil || saved.Hash != requestHash {
			return nil, errors.New("operation_conflict")
		}
		saved.Result.Reused = true
		return &saved.Result, nil
	} else if !os.IsNotExist(e) {
		return nil, e
	}
	pending := record{Hash: requestHash, Result: RunResult{State: "interrupted", ExitCode: -1, OperationID: r.OperationID, Output: "Previous execution did not settle; inspect workspace results and use a new operation only when rerun is intended."}}
	body, _ := json.Marshal(pending)
	if err = os.WriteFile(receipt, body, 0600); err != nil {
		return nil, err
	}
	timeout := r.TimeoutSeconds
	if timeout <= 0 {
		timeout = 90
	}
	if timeout > 120 {
		timeout = 120
	}
	runCtx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Second)
	defer cancel()
	stop := context.AfterFunc(m.ctx, cancel)
	defer stop()
	for _, directory := range []string{"tmp", "output", "home"} {
		if err = os.MkdirAll(filepath.Join(w.Root, directory), 0700); err != nil {
			return nil, err
		}
	}
	env := scriptEnvironment(w.Root, exe)
	out := &boundedOutput{}
	exit, runErr := runLocalProcess(runCtx, w.Root, exe, append([]string{script}, r.Args...), env, out)
	result := RunResult{State: "completed", ExitCode: exit, Output: strings.ToValidUTF8(string(out.body), "�"), Truncated: out.truncated, OperationID: r.OperationID}
	if runErr != nil {
		result.State = "failed"
		if runCtx.Err() != nil {
			result.State = "stopped"
		}
		result.Output += "\n" + runErr.Error()
	} else if exit != 0 {
		result.State = "failed"
	}
	pending.Result = result
	body, _ = json.Marshal(pending)
	if err = os.WriteFile(receipt, body, 0600); err != nil {
		return nil, err
	}
	return &result, nil
}

func runtimeExecutable(source string) (string, error) {
	info, err := os.Stat(source)
	if err != nil || !info.Mode().IsRegular() {
		return "", errors.New("runtime_not_installed")
	}
	return filepath.Abs(source)
}

// Keep normal executable lookup and network settings without forwarding the
// application's arbitrary environment (provider keys, tokens or Node hooks).
func scriptEnvironment(root, executable string) []string {
	allowed := map[string]bool{}
	for _, key := range []string{"PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "USERPROFILE", "LOCALAPPDATA", "LANG", "LC_ALL", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "SSL_CERT_FILE", "SSL_CERT_DIR", "PRODUCER_FFMPEG_PATH", "PRODUCER_FFPROBE_PATH", "HYPERFRAMES_BROWSER_PATH"} {
		allowed[key] = true
	}
	values := map[string]string{}
	for _, item := range os.Environ() {
		key, value, ok := strings.Cut(item, "=")
		if ok && allowed[strings.ToUpper(key)] {
			values[key] = value
		}
	}
	for key := range values {
		if strings.EqualFold(key, "PATH") {
			delete(values, key)
		}
	}
	values["PATH"] = filepath.Dir(executable) + string(os.PathListSeparator) + os.Getenv("PATH")
	for key, value := range map[string]string{
		"TEMP": filepath.Join(root, "tmp"), "TMP": filepath.Join(root, "tmp"), "TMPDIR": filepath.Join(root, "tmp"),
		"HOME": filepath.Join(root, "home"), "APPDATA": filepath.Join(root, "home"),
		"PYTHONUSERBASE": filepath.Join(root, "home", "python"), "PIP_CACHE_DIR": filepath.Join(root, "tmp", "pip"),
		"npm_config_cache": filepath.Join(root, "tmp", "npm"), "npm_config_prefix": filepath.Join(root, "deps"),
		"PYTHONDONTWRITEBYTECODE": "1", "PYTHONUTF8": "1",
	} {
		values[key] = value
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		env = append(env, key+"="+values[key])
	}
	return env
}

func Status(node, python string) map[string]any {
	available := func(file string) bool { i, e := os.Stat(file); return e == nil && i.Mode().IsRegular() }
	return map[string]any{"sandbox": false, "executionMode": "full-access", "node": available(node), "python": available(python), "scope": "current-os-user", "network": "system-network", "maxSeconds": 120}
}
func (w *Workspace) Info() map[string]any {
	return map[string]any{"root": w.Root, "folders": []string{"skills", "materials", "output", "tmp"}, "nativeEditing": "Use edit_* and hyperframes_* tools for live timeline changes and undo."}
}

func (w *Workspace) Runs() (any, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	entries, err := os.ReadDir(filepath.Join(filepath.Dir(w.Root), "receipts"))
	if os.IsNotExist(err) {
		return []RunResult{}, nil
	}
	if err != nil {
		return nil, err
	}
	results := []RunResult{}
	sort.Slice(entries, func(i, j int) bool {
		a, ea := entries[i].Info()
		b, eb := entries[j].Info()
		return ea == nil && eb == nil && a.ModTime().After(b.ModTime())
	})
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		body, err := os.ReadFile(filepath.Join(filepath.Dir(w.Root), "receipts", entry.Name()))
		if err != nil {
			return nil, err
		}
		var record struct{ Result RunResult }
		if json.Unmarshal(body, &record) != nil {
			return nil, errors.New("execution_receipt_invalid")
		}
		if len(record.Result.Output) > 1024 {
			record.Result.Output = strings.ToValidUTF8(record.Result.Output[:1024], "�")
			record.Result.Truncated = true
		}
		results = append(results, record.Result)
		if len(results) >= 100 {
			break
		}
	}
	return results, nil
}
