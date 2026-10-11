package generation

import (
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/protocol"
	"infinite-canvas/backend/internal/provider/comfyui"
)

type ComfyWorkflow struct {
	Graph        map[string]any  `json:"graph"`
	Fields       []WorkflowField `json:"fields"`
	OutputNodeID string          `json:"outputNodeId"`
	OutputField  string          `json:"outputField"`
}

func IsConfiguredInterface(value string) bool {
	return value == "custom-image" || value == "custom-video" || value == "comfyui-image" || value == "comfyui-video"
}

func ValidateConfiguredProvider(mode string, config Config) error {
	if !IsConfiguredInterface(config.InterfaceType) {
		return nil
	}
	if (mode != "image" && mode != "video") || !strings.HasSuffix(config.InterfaceType, "-"+mode) {
		return fmt.Errorf("所选接口不支持%s生成", mode)
	}
	if strings.HasPrefix(config.InterfaceType, "custom-") {
		if config.CustomProvider == nil {
			return fmt.Errorf("自定义接口尚未配置提交与结果映射")
		}
		if config.CustomProvider.Auth.Type != "none" && strings.TrimSpace(config.APIKey) == "" {
			return fmt.Errorf("请填写自定义接口密钥")
		}
		_, err := protocol.ConfiguredProvider(*config.CustomProvider, protocol.Capability(mode))
		return err
	}
	if _, err := comfyui.ValidateURL(config.BaseURL); err != nil {
		return err
	}
	if config.AuthType != "none" && config.AuthType != "bearer" && config.AuthType != "header" {
		return fmt.Errorf("请选择 ComfyUI 鉴权方式")
	}
	if config.AuthType != "none" && strings.TrimSpace(config.APIKey) == "" {
		return fmt.Errorf("请填写 ComfyUI 密钥")
	}
	if config.AuthType == "header" && strings.TrimSpace(config.AuthHeader) == "" {
		return fmt.Errorf("请填写鉴权请求头名称")
	}
	if config.ComfyUI == nil || len(config.ComfyUI.Graph) == 0 || len(config.ComfyUI.Graph) > 500 {
		return fmt.Errorf("请导入 API 格式 ComfyUI 工作流（最多 500 个节点）")
	}
	for id, raw := range config.ComfyUI.Graph {
		node, ok := raw.(map[string]any)
		class, _ := node["class_type"].(string)
		if !ok || strings.TrimSpace(class) == "" {
			return fmt.Errorf("节点 %s 不是 API 格式工作流，请从 ComfyUI 导出 API 格式", id)
		}
		if _, ok := node["inputs"].(map[string]any); !ok {
			return fmt.Errorf("节点 %s 缺少 inputs", id)
		}
	}
	if _, ok := config.ComfyUI.Graph[config.ComfyUI.OutputNodeID]; !ok {
		return fmt.Errorf("请选择工作流的最终输出节点")
	}
	switch config.ComfyUI.OutputField {
	case "images", "gifs", "videos", "audio":
	default:
		return fmt.Errorf("请选择输出字段")
	}
	return nil
}
