package app

import (
	"encoding/json"
	"infinite-canvas/backend/internal/calllog"
)

func (s *Service) CallLogDomain() calllog.Service {
	return calllog.Service{Store: s.repo, ChannelNames: func() map[string]string {
		names := map[string]string{}
		raw, err := s.ReadLocalModelConfig()
		if err != nil {
			return names
		}
		var config struct {
			Channels []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"channels"`
		}
		if json.Unmarshal(raw, &config) == nil {
			for _, channel := range config.Channels {
				names[channel.ID] = channel.Name
			}
		}
		return names
	}}
}
