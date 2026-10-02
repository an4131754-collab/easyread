"""翻譯 / 對話引擎的 API 預設：服務商、地址、推薦模型。"""

# 常見的 OpenAI 相容服務。region：cn 國內直連 / intl 海外（國內要開梯子）/ local 本機。free：有免費模型或免費額度。
# models：推薦的模型 {id, name 顯示名, tag 一句說明, vision 能看圖}；也能手填，或點“獲取模型列表”從介面拉全部。
# api：預設 chat（/chat/completions）；OpenAI 官方用 responses。
# 模型名和免費政策會變，以服務商頁面為準（2026-10 核對過）。


def _m(mid: str, name: str, tag: str = "", vision: bool = False) -> dict:
    return {"id": mid, "name": name, "tag": tag, "vision": vision}


PRESETS = [
    # ---- 國內直連 ----
    {"id": "deepseek", "region": "cn", "name": "DeepSeek", "base_url": "https://api.deepseek.com", "model": "deepseek-flash", "key": True, "free": False,
     "models": [_m("deepseek-flash", "DeepSeek V4.1 Flash", "便宜、能看圖", True), _m("deepseek-v4-pro", "DeepSeek V4 Pro", "更強，不能看圖")],
     "key_url": "https://platform.deepseek.com/api_keys", "note": "開源模型的官方介面，一篇 20 頁論文幾毛錢。"},
    {"id": "zhipu", "region": "cn", "name": "智譜", "base_url": "https://open.bigmodel.cn/api/paas/v4", "model": "glm-4.7-flash", "key": True, "free": True,
     "models": [_m("glm-4.7-flash", "GLM-4.7-Flash", "免費"), _m("glm-4.6v-flash", "GLM-4.6V-Flash", "免費、能看圖", True),
                _m("glm-5.3-flash", "GLM-5.3-Flash", "付費、能看圖", True), _m("glm-5.3", "GLM-5.3", "付費、最強")],
     "key_url": "https://open.bigmodel.cn/usercenter/apikeys", "note": "GLM-4.7-Flash、GLM-4.6V-Flash 免費。"},
    {"id": "dashscope", "region": "cn", "name": "阿里雲百鍊（通義千問）", "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen3.8-flash", "key": True, "free": False,
     "models": [_m("qwen3.8-flash", "Qwen3.8-Flash", "便宜、能看圖", True), _m("qwen3.7-plus", "Qwen3.7-Plus", "均衡、能看圖", True),
                _m("qwen3.8-max", "Qwen3.8-Max", "最強、能看圖", True)],
     "key_url": "https://bailian.console.aliyun.com/?apiKey=1", "note": "新使用者有免費額度。"},
    {"id": "moonshot", "region": "cn", "name": "Kimi", "base_url": "https://api.moonshot.cn/v1", "model": "kimi-k3", "key": True, "free": False,
     "models": [_m("kimi-k3", "Kimi K3", "能看圖", True), _m("kimi-k2.6", "Kimi K2.6", "能看圖", True)],
     "key_url": "https://platform.moonshot.cn/console/api-keys", "note": "月之暗面的官方介面。"},
    {"id": "siliconflow", "region": "cn", "name": "矽基流動", "base_url": "https://api.siliconflow.cn/v1", "model": "Qwen/Qwen3-8B", "key": True, "free": True,
     "models": [_m("Qwen/Qwen3-8B", "Qwen3 8B", "免費"), _m("Qwen/Qwen3.5-4B", "Qwen3.5 4B", "免費"), _m("THUDM/GLM-4-9B-0414", "GLM-4 9B", "免費"),
                _m("deepseek-ai/DeepSeek-V4-Flash", "DeepSeek V4 Flash", "付費"), _m("zai-org/GLM-5.3", "GLM-5.3", "付費")],
     "key_url": "https://cloud.siliconflow.cn/account/ak", "note": "託管各家開源模型，小模型免費、大模型付費。"},
    {"id": "modelscope", "region": "cn", "name": "魔搭 ModelScope", "base_url": "https://api-inference.modelscope.cn/v1", "model": "Qwen/Qwen3.8-27B", "key": True, "free": True,
     "models": [_m("Qwen/Qwen3.8-27B", "Qwen3.8 27B"), _m("Qwen/Qwen3.5-122B-A10B", "Qwen3.5 122B"),
                _m("deepseek-ai/DeepSeek-V4.1-Flash", "DeepSeek V4.1 Flash"), _m("ZhipuAI/GLM-5.2", "GLM-5.2")],
     "key_url": "https://modelscope.cn/my/myaccesstoken", "note": "阿里的開源模型社群，每天有免費呼叫次數（要繫結阿里雲賬號）。"},
    # ---- 海外（國內要開梯子） ----
    {"id": "openai", "region": "intl", "name": "OpenAI", "base_url": "https://api.openai.com/v1", "model": "gpt-6-luna", "key": True, "free": False, "api": "responses",
     "models": [_m("gpt-6-luna", "GPT-6 Luna", "最便宜", True), _m("gpt-6.1-sol", "GPT-6.1 Sol", "均衡", True), _m("gpt-6-astra", "GPT-6 Astra", "最強", True)],
     "key_url": "https://platform.openai.com/api-keys", "note": "用 Responses 介面。"},
    {"id": "anthropic", "region": "intl", "name": "Anthropic", "base_url": "https://api.anthropic.com/v1", "model": "claude-sonnet-5-5", "key": True, "free": False,
     "models": [_m("claude-sonnet-5-5", "Claude Sonnet 5.5", "均衡", True), _m("claude-opus-5-5", "Claude Opus 5.5", "更強", True),
                _m("claude-haiku-4-5", "Claude Haiku 4.5", "最快最省", True), _m("claude-fable-5-1", "Claude Fable 5.1", "最強、最貴", True)],
     "key_url": "https://platform.claude.com/settings/keys", "note": "Claude 的 API（按量付費，和 Claude 訂閱是兩回事；有訂閱就用上面的 Claude Code）。"},
    {"id": "gemini", "region": "intl", "name": "Google Gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai", "model": "gemini-3.8-flash", "key": True, "free": True,
     "models": [_m("gemini-3.8-flash", "Gemini 3.8 Flash", "有免費額度、能看圖", True), _m("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", "有免費額度、最快", True),
                _m("gemini-3.1-pro-preview", "Gemini 3.1 Pro", "付費、最強", True)],
     "key_url": "https://aistudio.google.com/apikey", "note": "Flash 系列有免費額度。"},
    {"id": "openrouter", "region": "intl", "name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "model": "qwen/qwen3.8-27b:free", "key": True, "free": True,
     "models": [_m("qwen/qwen3.8-27b:free", "Qwen3.8 27B", "免費"), _m("google/gemma-4-31b-it:free", "Gemma 4 31B", "免費"),
                _m("nvidia/nemotron-3-super-120b-a12b:free", "Nemotron 3 Super", "免費")],
     "key_url": "https://openrouter.ai/keys", "note": "一個 Key 用各家模型；帶 :free 的免費，有頻率限制，名單常變，點“獲取模型列表”看最新的。"},
    {"id": "groq", "region": "intl", "name": "Groq", "base_url": "https://api.groq.com/openai/v1", "model": "openai/gpt-oss-120b", "key": True, "free": True,
     "models": [_m("openai/gpt-oss-120b", "GPT-OSS 120B", "免費額度"), _m("qwen/qwen3.8-27b", "Qwen3.8 27B", "免費額度、預覽"),
                _m("llama-3.3-70b-versatile", "Llama 3.3 70B", "免費額度")],
     "key_url": "https://console.groq.com/keys", "note": "開源模型、速度很快；有每分鐘頻率限制，“同時翻譯幾批”開 1–2。"},
    {"id": "cerebras", "region": "intl", "name": "Cerebras", "base_url": "https://api.cerebras.ai/v1", "model": "gpt-oss-120b", "key": True, "free": True,
     "models": [_m("gpt-oss-120b", "GPT-OSS 120B", "免費額度"), _m("qwen-3.8-27b", "Qwen3.8 27B", "免費額度")],
     "key_url": "https://cloud.cerebras.ai", "note": "開源模型、速度很快。"},
    # ---- 本機 ----
    {"id": "ollama", "region": "local", "name": "Ollama", "base_url": "http://127.0.0.1:11434/v1", "model": "qwen3.5:9b", "key": False, "free": True,
     "models": [_m("qwen3.5:9b", "Qwen3.5 9B", "下載 6.6 GB，推薦"), _m("qwen3.5:4b", "Qwen3.5 4B", "下載 3.4 GB，顯示卡小用"),
                _m("qwen3.5:27b", "Qwen3.5 27B", "下載 17 GB，譯得更好"), _m("gemma4:12b", "Gemma 4 12B")],
     "key_url": "https://ollama.com/download", "note": "裝好 Ollama，再在終端執行 ollama pull qwen3.5:9b。完全離線、免費。"},
    {"id": "lmstudio", "region": "local", "name": "LM Studio", "base_url": "http://127.0.0.1:1234/v1", "model": "", "key": False, "free": True,
     "models": [],
     "key_url": "https://lmstudio.ai", "note": "在 LM Studio 裡下載模型，開啟 Developer → Start Server，再點“獲取模型列表”選一個。"},
]
# 這些服務在國內要開梯子才連得上（連不上時提示使用者）
NEEDS_VPN = {p["id"] for p in PRESETS if p["region"] == "intl"}
PRESET_GROUPS = [("cn", "國內直連"), ("intl", "海外（國內要開梯子）"), ("local", "本機執行（離線、免費）")]
