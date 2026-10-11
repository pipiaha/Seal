package platform

import (
	"infinite-canvas/backend/internal/callpayload"
	"net/http"
)

func SanitizeAPICallPayload(data []byte, contentType string) string {
	return callpayload.SanitizeAPICallPayload(data, contentType)
}

func RequestPayloadForLog(req *http.Request) string {
	return callpayload.RequestPayloadForLog(req)
}

func SanitizeAPICallURL(value string) string {
	return callpayload.SanitizeAPICallURL(value)
}

func SanitizeAPICallText(value string) string {
	return callpayload.SanitizeAPICallText(value)
}
