package handler

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/assistant"
)

// Images are user-provided observations. They confer no additional file or tool access.
type assistantImage struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	MimeType string `json:"mimeType"`
	Data     string `json:"data"`
	Source   string `json:"source,omitempty"`
}

func validateAssistantImages(images []assistantImage, provider assistant.Provider) error {
	if len(images) == 0 {
		return nil
	}
	if provider.MaxImages <= 0 || provider.MaxImageBytes <= 0 {
		return errors.New("当前助手模型未开启图片输入，请在模型配置中开启图片引用，或切换支持视觉的模型")
	}
	if len(images) > provider.MaxImages {
		return errors.New("图片数量超过当前模型允许的数量（产品最多 8 张）")
	}
	total := 0
	seen := map[string]bool{}
	for _, item := range images {
		if item.ID == "" || len(item.ID) > 160 || seen[item.ID] || utf8.RuneCountInString(item.Name) > 240 || utf8.RuneCountInString(item.Source) > 512 {
			return errors.New("图片附件信息无效")
		}
		seen[item.ID] = true
		if len(item.Data) > base64.StdEncoding.EncodedLen(provider.MaxImageBytes) {
			return errors.New("图片大小超过当前模型允许的大小")
		}
		data, err := base64.StdEncoding.Strict().DecodeString(item.Data)
		if err != nil || len(data) == 0 || len(data) > provider.MaxImageBytes {
			return errors.New("图片内容无效或过大")
		}
		total += len(data)
		if total > 12<<20 {
			return errors.New("一次消息的图片总大小不能超过 12 MiB")
		}
		config, format, err := image.DecodeConfig(bytes.NewReader(data))
		if err != nil || (format != "png" && format != "jpeg") || item.MimeType != "image/"+format || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 16_777_216 {
			return errors.New("请提供可读取的 PNG 或 JPEG 图片，画面总像素不能超过 1677 万")
		}
		if strings.ContainsAny(item.Name, "\r\n\x00") {
			return errors.New("图片名称无效")
		}
		if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
			return errors.New("图片数据不完整，请重新添加")
		}
	}
	return nil
}
