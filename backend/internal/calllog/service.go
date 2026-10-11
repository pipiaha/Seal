package calllog

import (
	"errors"
	"infinite-canvas/backend/internal/callpayload"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"strings"
)

type Filter struct {
	Capability string
	Status     string
	Keyword    string
	ChannelID  string
	TaskID     string
	Page       int
	Limit      int
}

type Entry struct {
	model.ApiCallLog
	TaskStage         string `json:"taskStage,omitempty"`
	ProjectID         string `json:"projectId,omitempty"`
	RequestCount      int64  `json:"requestCount"`
	CurrentTaskStatus string `json:"-"`
	Outcome           string `json:"outcome" gorm:"-"`
}

type Page struct {
	Items    []Entry `json:"items"`
	Total    int64   `json:"total"`
	Page     int     `json:"page"`
	PageSize int     `json:"pageSize"`
}

type Detail struct {
	Entry    Entry              `json:"entry"`
	Requests []model.ApiCallLog `json:"requests"`
	Total    int64              `json:"total"`
	Page     int                `json:"page"`
	PageSize int                `json:"pageSize"`
}

var ErrNotFound = errors.New("调用记录不存在")

type Store interface {
	ListMediaCallLogs(string, Filter) ([]Entry, int64, error)
	MediaCallLogForUser(string, string) (Entry, error)
	MediaCallLogRequests(string, model.ApiCallLog, int, int) ([]model.ApiCallLog, int64, error)
}

type Service struct {
	Store        Store
	ChannelNames func() map[string]string
}

func (s Service) List(userID string, filter Filter) (Page, error) {
	if userID == "" {
		return Page{}, kernel.BadAuthRequest("工作区未初始化")
	}
	switch filter.Capability {
	case "", "image", "video", "audio", "asr":
	default:
		return Page{}, kernel.BadAuthRequest("不支持的调用类型")
	}
	switch filter.Status {
	case "", "succeeded", "failed", "running", "uncertain":
	default:
		return Page{}, kernel.BadAuthRequest("不支持的调用状态")
	}
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.Limit < 1 || filter.Limit > 100 {
		filter.Limit = 30
	}
	filter.Keyword = strings.TrimSpace(filter.Keyword)
	if len(filter.Keyword) > 256 {
		return Page{}, kernel.BadAuthRequest("搜索内容过长")
	}
	items, total, err := s.Store.ListMediaCallLogs(userID, filter)
	if err != nil {
		return Page{}, err
	}
	names := s.names()
	for i := range items {
		s.enrich(&items[i], names)
	}
	return Page{Items: items, Total: total, Page: filter.Page, PageSize: filter.Limit}, nil
}

func (s Service) Detail(userID, id string, page int) (Detail, error) {
	entry, err := s.Store.MediaCallLogForUser(userID, id)
	if err != nil {
		return Detail{}, err
	}
	if page < 1 {
		page = 1
	}
	const pageSize = 30
	requests, total, err := s.Store.MediaCallLogRequests(userID, entry.ApiCallLog, page, pageSize)
	if err != nil {
		return Detail{}, err
	}
	names := s.names()
	s.enrich(&entry, names)
	entry.RequestBody = ""
	entry.ResponseBody = ""
	for i := range requests {
		sanitize(&requests[i])
		requests[i].ChannelName = names[requests[i].ChannelID]
	}
	return Detail{Entry: entry, Requests: requests, Total: total, Page: page, PageSize: pageSize}, nil
}

func (s Service) Request(userID, groupID, id string) (model.ApiCallLog, error) {
	group, err := s.Store.MediaCallLogForUser(userID, groupID)
	if err != nil {
		return model.ApiCallLog{}, err
	}
	request, err := s.Store.MediaCallLogForUser(userID, id)
	if err != nil {
		return model.ApiCallLog{}, err
	}
	if group.TaskID == "" && group.ID != request.ID || group.TaskID != "" && group.TaskID != request.TaskID {
		return model.ApiCallLog{}, ErrNotFound
	}
	sanitize(&request.ApiCallLog)
	request.ChannelName = s.names()[request.ChannelID]
	return request.ApiCallLog, nil
}

func (s Service) names() map[string]string {
	names := map[string]string{}
	if s.ChannelNames != nil {
		names = s.ChannelNames()
	}
	names["online-asr"] = "在线 ASR"
	return names
}

func (s Service) enrich(entry *Entry, names map[string]string) {
	sanitize(&entry.ApiCallLog)
	entry.ChannelName = names[entry.ChannelID]
	entry.Outcome = string(entry.Status)
	if entry.CurrentTaskStatus != "" {
		entry.Outcome = entry.CurrentTaskStatus
		entry.TaskStatus = model.TaskStatus(entry.CurrentTaskStatus)
	}
	if entry.TaskStage == "submission_unknown" {
		entry.Outcome = "uncertain"
	}
}

func sanitize(log *model.ApiCallLog) {
	log.UpstreamURL = callpayload.SanitizeAPICallURL(log.UpstreamURL)
	log.RequestBody = callpayload.SanitizeAPICallPayload([]byte(log.RequestBody), log.RequestContentType)
	log.ResponseBody = callpayload.SanitizeAPICallPayload([]byte(log.ResponseBody), "")
	log.Error = callpayload.SanitizeAPICallText(log.Error)
}
