import { memo, useDeferredValue } from 'react';
import { AIMessageMarkdown } from '@/components/ai/ai-message-markdown';
import { assistantVisibleReply } from './canvas-assistant-copy';

/** 与首页共用流式 Markdown；隐藏思考文本并禁用原始 HTML。 */
export const CanvasAssistantReply = memo(function CanvasAssistantReply({ text, isStreaming = false }: { text: string; isStreaming?: boolean }) {
    const deferredText = useDeferredValue(text);
    const visible = assistantVisibleReply(isStreaming ? deferredText : text);
    if (!visible) return null;
    return <div className="canvas-assistant-reply"><AIMessageMarkdown isStreaming={isStreaming}>{visible}</AIMessageMarkdown></div>;
});
