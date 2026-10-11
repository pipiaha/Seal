package transcription

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type whisperSegment struct {
	Start float64 `json:"start"`
	End   float64 `json:"end"`
	Text  string  `json:"text"`
}

type whisperVerboseJSON struct {
	Segments []whisperSegment `json:"segments"`
	Language string           `json:"language"`
}

type Client struct {
	BaseURL  string
	HTTP     *http.Client
	APIKey   string
	Model    string
	Endpoint string
	Observe  func(*http.Request, time.Time, int, []byte, error)
}

func NewClient(baseURL string) *Client {
	return &Client{
		BaseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		HTTP:    &http.Client{Timeout: 20 * time.Minute},
	}
}

func (c *Client) Transcribe(ctx context.Context, wavPath string, language string) ([]Segment, string, error) {
	if c == nil || c.BaseURL == "" {
		return transcribeLocal(ctx, wavPath, language)
	}
	httpClient := c.HTTP
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 20 * time.Minute}
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	audio, err := os.Open(wavPath)
	if err != nil {
		return nil, "", fmt.Errorf("读取待转写音频失败: %w", err)
	}
	defer audio.Close()
	part, err := writer.CreateFormFile("file", filepath.Base(wavPath))
	if err != nil {
		return nil, "", err
	}
	if _, err := io.Copy(part, audio); err != nil {
		return nil, "", fmt.Errorf("上传音频失败: %w", err)
	}
	if err := writer.WriteField("response_format", "verbose_json"); err != nil {
		return nil, "", err
	}
	if c.Endpoint != "" && c.Model != "" {
		if err := writer.WriteField("model", c.Model); err != nil {
			return nil, "", err
		}
	}
	if strings.TrimSpace(language) != "" {
		if err := writer.WriteField("language", strings.TrimSpace(language)); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}

	endpoint := c.Endpoint
	if endpoint == "" {
		endpoint = "/inference"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+endpoint, &body)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Content-Type", writer.FormDataContentType())
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	startedAt := time.Now()
	statusCode := 0
	var payload []byte
	var requestErr error
	defer func() {
		if c.Observe != nil {
			c.Observe(req, startedAt, statusCode, payload, requestErr)
		}
	}()
	resp, err := httpClient.Do(req)
	if err != nil {
		requestErr = err
		return nil, "", fmt.Errorf("无法连接转写服务，请检查地址与网络")
	}
	defer resp.Body.Close()
	statusCode = resp.StatusCode
	payload, err = io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		requestErr = err
		return nil, "", fmt.Errorf("读取转写结果失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("转写服务返回 %d，请检查密钥、模型及服务配额", resp.StatusCode)
	}
	segments, languageOut, err := DecodeVerboseJSON(payload)
	if err != nil {
		requestErr = err
		return nil, "", err
	}
	if len(segments) == 0 {
		requestErr = fmt.Errorf("转写服务未识别出语音内容")
		return nil, "", requestErr
	}
	return segments, languageOut, nil
}

func DecodeVerboseJSON(payload []byte) ([]Segment, string, error) {
	var parsed whisperVerboseJSON
	if err := json.Unmarshal(payload, &parsed); err != nil {
		return nil, "", fmt.Errorf("转写结果解析失败: %w", err)
	}
	segments := make([]Segment, 0, len(parsed.Segments))
	for _, seg := range parsed.Segments {
		if strings.TrimSpace(seg.Text) == "" {
			continue
		}
		segments = append(segments, Segment{
			StartMs: int64(math.Round(seg.Start * 1000)),
			EndMs:   int64(math.Round(seg.End * 1000)),
			Text:    strings.TrimSpace(seg.Text),
		})
	}
	return segments, parsed.Language, nil
}
