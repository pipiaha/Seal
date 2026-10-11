//go:build windows

package agentworkspace

import (
	"context"
	"crypto/sha256"
	"fmt"
	"golang.org/x/sys/windows"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var userenv = windows.NewLazySystemDLL("userenv.dll")
var createProfile = userenv.NewProc("CreateAppContainerProfile")
var deriveProfile = userenv.NewProc("DeriveAppContainerSidFromAppContainerName")
var freeSID = windows.NewLazySystemDLL("advapi32.dll").NewProc("FreeSid")

type securityCapabilities struct {
	SID          *windows.SID
	Capabilities *windows.SIDAndAttributes
	Count        uint32
	Reserved     uint32
}

func sandboxAvailable() bool { return createProfile.Find() == nil && deriveProfile.Find() == nil }

func isLink(info os.FileInfo) bool {
	if info.Mode()&os.ModeSymlink != 0 {
		return true
	}
	data, ok := info.Sys().(*syscall.Win32FileAttributeData)
	return ok && data.FileAttributes&windows.FILE_ATTRIBUTE_REPARSE_POINT != 0
}

// Only service-created working directories receive a low integrity label. We
// never change ACLs on the user's assets, Skills, secrets or native edit projects.
func grant(path string, sid *windows.SID, writable bool) error {
	sd, err := windows.GetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION)
	if err != nil {
		return err
	}
	old, _, err := sd.DACL()
	if err != nil {
		return err
	}
	permissions := windows.ACCESS_MASK(0x1200a9) // read, traverse and execute; no WRITE_DAC
	if writable {
		permissions = 0x1301bf
	} // modify, without changing security
	acl, err := windows.ACLFromEntries([]windows.EXPLICIT_ACCESS{{AccessPermissions: permissions, AccessMode: windows.GRANT_ACCESS, Inheritance: windows.SUB_CONTAINERS_AND_OBJECTS_INHERIT, Trustee: windows.TRUSTEE{TrusteeForm: windows.TRUSTEE_IS_SID, TrusteeType: windows.TRUSTEE_IS_UNKNOWN, TrusteeValue: windows.TrusteeValueFromSID(sid)}}}, old)
	if err != nil {
		return err
	}
	if err = windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.DACL_SECURITY_INFORMATION, nil, nil, acl, nil); err != nil {
		return err
	}
	if writable {
		label, e := windows.SecurityDescriptorFromString("S:(ML;OICI;NW;;;LW)")
		if e != nil {
			return e
		}
		sacl, _, e := label.SACL()
		if e != nil {
			return e
		}
		return windows.SetNamedSecurityInfo(path, windows.SE_FILE_OBJECT, windows.LABEL_SECURITY_INFORMATION, nil, nil, nil, sacl)
	}
	return nil
}

func runSandbox(ctx context.Context, root, executable string, args, env []string, output io.Writer) (int, error) {
	digest := sha256.Sum256([]byte(strings.ToLower(root)))
	name, _ := windows.UTF16PtrFromString(fmt.Sprintf("Seal.Workspace.%x", digest[:16]))
	var sid *windows.SID
	hr, _, _ := createProfile.Call(uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(name)), 0, 0, uintptr(unsafe.Pointer(&sid)))
	if uint32(hr) == 0x800700b7 {
		hr, _, _ = deriveProfile.Call(uintptr(unsafe.Pointer(name)), uintptr(unsafe.Pointer(&sid)))
	}
	if int32(hr) < 0 || sid == nil {
		return -1, fmt.Errorf("AppContainer profile: HRESULT %x", hr)
	}
	defer freeSID.Call(uintptr(unsafe.Pointer(sid)))
	if err := grant(root, sid, true); err != nil {
		return -1, fmt.Errorf("workspace ACL: %w", err)
	}
	// The runtime must live in its dedicated distribution, not the host module or
	// application data directory. It is granted read/execute, never write.
	if err := grant(filepath.Dir(executable), sid, false); err != nil {
		return -1, fmt.Errorf("runtime ACL: %w", err)
	}
	return runWindowsProcess(ctx, root, executable, args, env, output, sid)
}

func runLocalProcess(ctx context.Context, root, executable string, args, env []string, output io.Writer) (int, error) {
	return runWindowsProcess(ctx, root, executable, args, env, output, nil)
}

// Ordinary scripts keep the caller's token. The Job Object owns cancellation,
// not file or network permissions; only the optional lowbox adds those limits.
func runWindowsProcess(ctx context.Context, root, executable string, args, env []string, output io.Writer, sid *windows.SID) (int, error) {
	if err := ctx.Err(); err != nil {
		return -1, err
	}
	count := uint32(1)
	if sid != nil {
		count++
	}
	attributes, err := windows.NewProcThreadAttributeList(count)
	if err != nil {
		return -1, err
	}
	defer attributes.Delete()
	var security securityCapabilities
	if sid != nil {
		internet, err := windows.StringToSid("S-1-15-3-1")
		if err != nil {
			return -1, err
		}
		cap := &windows.SIDAndAttributes{Sid: internet, Attributes: windows.SE_GROUP_ENABLED}
		security = securityCapabilities{SID: sid, Capabilities: cap, Count: 1}
		if err = attributes.Update(0x20009, unsafe.Pointer(&security), unsafe.Sizeof(security)); err != nil {
			return -1, err
		}
	}
	read, write, err := os.Pipe()
	if err != nil {
		return -1, err
	}
	defer read.Close()
	defer write.Close()
	null, err := os.Open(os.DevNull)
	if err != nil {
		return -1, err
	}
	defer null.Close()
	handles := []windows.Handle{windows.Handle(write.Fd()), windows.Handle(null.Fd())}
	for _, h := range handles {
		if err = windows.SetHandleInformation(h, windows.HANDLE_FLAG_INHERIT, windows.HANDLE_FLAG_INHERIT); err != nil {
			return -1, err
		}
	}
	if err = attributes.Update(windows.PROC_THREAD_ATTRIBUTE_HANDLE_LIST, unsafe.Pointer(&handles[0]), uintptr(len(handles))*unsafe.Sizeof(handles[0])); err != nil {
		return -1, err
	}
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return -1, err
	}
	defer windows.CloseHandle(job)
	limits := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	limits.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if sid != nil {
		limits.BasicLimitInformation.LimitFlags |= windows.JOB_OBJECT_LIMIT_ACTIVE_PROCESS | windows.JOB_OBJECT_LIMIT_JOB_MEMORY
		limits.BasicLimitInformation.ActiveProcessLimit = 16
		limits.JobMemoryLimit = 2 << 30
	}
	if _, err = windows.SetInformationJobObject(job, windows.JobObjectExtendedLimitInformation, uintptr(unsafe.Pointer(&limits)), uint32(unsafe.Sizeof(limits))); err != nil {
		return -1, err
	}
	if sid != nil {
		uiLimits := uint32(0xff)
		if _, err = windows.SetInformationJobObject(job, windows.JobObjectBasicUIRestrictions, uintptr(unsafe.Pointer(&uiLimits)), uint32(unsafe.Sizeof(uiLimits))); err != nil {
			return -1, err
		}
	}
	startup := windows.StartupInfoEx{StartupInfo: windows.StartupInfo{Cb: uint32(unsafe.Sizeof(windows.StartupInfoEx{})), Flags: windows.STARTF_USESTDHANDLES, StdInput: handles[1], StdOutput: handles[0], StdErr: handles[0]}, ProcThreadAttributeList: attributes.List()}
	app, _ := windows.UTF16PtrFromString(executable)
	command, err := windows.UTF16PtrFromString(windows.ComposeCommandLine(append([]string{executable}, args...)))
	if err != nil {
		return -1, err
	}
	cwd, _ := windows.UTF16PtrFromString(root)
	// UTF16FromString rejects interior NULs; construct the environment block explicitly.
	environment := []uint16{}
	if sid != nil {
		// Windows needs these OS locations to build an AppContainer profile.
		env = append(env, "USERPROFILE="+os.Getenv("USERPROFILE"), "LOCALAPPDATA="+os.Getenv("LOCALAPPDATA"), "APPDATA="+root, "SystemDrive="+os.Getenv("SystemDrive"), "WINDIR="+os.Getenv("WINDIR"))
	}
	for _, value := range env {
		v, e := windows.UTF16FromString(value)
		if e != nil {
			return -1, e
		}
		environment = append(environment, v...)
	}
	environment = append(environment, 0)
	var process windows.ProcessInformation
	err = windows.CreateProcess(app, command, nil, nil, true, windows.CREATE_SUSPENDED|windows.CREATE_NO_WINDOW|windows.CREATE_UNICODE_ENVIRONMENT|windows.EXTENDED_STARTUPINFO_PRESENT, &environment[0], cwd, &startup.StartupInfo, &process)
	runtime.KeepAlive(security)
	runtime.KeepAlive(environment)
	if err != nil {
		return -1, fmt.Errorf("CreateProcess: %w", err)
	}
	defer windows.CloseHandle(process.Process)
	defer windows.CloseHandle(process.Thread)
	if err = windows.AssignProcessToJobObject(job, process.Process); err != nil {
		windows.TerminateProcess(process.Process, 1)
		return -1, err
	}
	if _, err = windows.ResumeThread(process.Thread); err != nil {
		windows.TerminateJobObject(job, 1)
		return -1, err
	}
	write.Close()
	copied := make(chan struct{})
	go func() { io.Copy(output, read); close(copied) }()
	defer func() { read.Close(); <-copied }()
	var exit uint32
	for {
		state, e := windows.WaitForSingleObject(process.Process, 50)
		if e != nil {
			windows.TerminateJobObject(job, 1)
			return -1, e
		}
		if state == windows.WAIT_OBJECT_0 {
			windows.GetExitCodeProcess(process.Process, &exit)
			break
		}
		if ctx.Err() != nil {
			windows.TerminateJobObject(job, 1)
			windows.WaitForSingleObject(process.Process, 5000)
			read.Close()
			<-copied
			return -1, ctx.Err()
		}
	}
	// A script cannot leave children running after returning success.
	windows.TerminateJobObject(job, 0)
	select {
	case <-copied:
	case <-time.After(time.Second):
		read.Close()
		<-copied
	}
	return int(exit), nil
}
