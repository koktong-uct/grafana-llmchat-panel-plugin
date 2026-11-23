FROM grafana-global-dashboard-llm:v1.7

COPY uct-llmchat-panel /var/lib/grafana/plugins/uct-llmchat-panel

ENV GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=uct-llmchat-panel
