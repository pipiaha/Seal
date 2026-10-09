package handler

import "encoding/json"

// Overview is derived from the owned document. Large content, URLs and prompts
// are intentionally excluded; the assistant reads those through scoped tools.
func assistantContextOverview(raw json.RawMessage, selected []string) map[string]any {
	var doc struct {
		Title    string `json:"title"`
		Revision int64  `json:"revision"`
		Nodes    []struct {
			ID    string `json:"id"`
			Type  string `json:"type"`
			Title string `json:"title"`
			Data  struct {
				Title string `json:"title"`
			} `json:"data"`
		} `json:"nodes"`
		Edges       []json.RawMessage `json:"edges"`
		Connections []json.RawMessage `json:"connections"`
	}
	if json.Unmarshal(raw, &doc) != nil {
		return nil
	}
	wanted := map[string]bool{}
	for _, id := range selected {
		wanted[id] = true
	}
	nodes := []map[string]string{}
	for _, node := range doc.Nodes {
		if len(nodes) >= 20 {
			break
		}
		if len(selected) > 0 && !wanted[node.ID] {
			continue
		}
		label := node.Title
		if label == "" {
			label = node.Data.Title
		}
		title := []rune(label)
		if len(title) > 120 {
			title = title[:120]
		}
		nodes = append(nodes, map[string]string{"id": node.ID, "type": node.Type, "title": string(title)})
	}
	title := []rune(doc.Title)
	if len(title) > 160 {
		title = title[:160]
	}
	return map[string]any{"title": string(title), "revision": doc.Revision, "nodeCount": len(doc.Nodes), "edgeCount": len(doc.Edges) + len(doc.Connections), "nodes": nodes}
}
