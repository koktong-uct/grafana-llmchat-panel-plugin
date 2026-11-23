# Llm-Chat Grafana Panel

Llm-Chat adds a chat-style interface for interacting with a large language model (LLM) from a Grafana dashboard. It uses Grafana's built-in LLM configuration, so you can connect a local model (such as Ollama or LM Studio) or a cloud provider.

## Requirements

- Grafana 12.1.0 or later
- An LLM provider configured in Grafana:
  - For a local model, its reachable address and port (Ollama's default is `11434`)
  - For a cloud provider, the required API key
- WSL for plugin development on Windows

## Install

Copy the `uct-llmchat-panel` folder into Grafana's plugins directory and allow the unsigned plugin in `grafana.ini`:

```ini
[plugins]
allow_loading_unsigned_plugins = uct-llmchat-panel
```

Restart Grafana, add a panel to a dashboard, and select **Llm-Chat**.

## Develop the plugin

### Set up the source in WSL

Install WSL, then open a WSL terminal. To clone your plugin repository:

```bash
mkdir -p ~/grafana-plugins
cd ~/grafana-plugins
git clone <your-plugin-repo-url> uct-llmchat-panel
cd uct-llmchat-panel
```

If you already have the source in WSL, go to its directory instead:

```bash
cd ~/grafana-plugins/uct-llmchat-panel
```

The source project includes `src/components/SimplePanel.tsx`, a React component written in TypeScript. Open it in VS Code from the plugin directory:

```bash
code ./src/components/SimplePanel.tsx
```

### Build and copy the plugin

From `~/grafana-plugins/uct-llmchat-panel`, build the plugin:

```bash
npm run build
```

Copy the generated `dist` contents to the Windows Docker build folder:

```bash
mkdir -p /mnt/c/GrafanaDev/image-build/uct-llmchat-panel
cp -r dist/. /mnt/c/GrafanaDev/image-build/uct-llmchat-panel/
```

The Docker build folder should look like this:

```text
C:\GrafanaDev\
├── grafana-global-dashboard-llm-v1.7.tar
└── image-build\
    ├── Dockerfile
    └── uct-llmchat-panel\
        ├── module.js
        ├── plugin.json
        └── ...
```

If the plugin build removed or renamed files, make sure obsolete files are removed from the destination before building the image.

## Build and test the Docker image

The `Dockerfile` copies the plugin into Grafana's plugins directory and allows the unsigned plugin to load. It uses a previously supplied `grafana-global-dashboard-llm` image as its base.

If the base image is provided as a tar archive, load and inspect it in Windows PowerShell. Replace `1.7` with the version in your archive:

```powershell
docker load -i C:\GrafanaDev\grafana-global-dashboard-llm-v1.7.tar
docker image inspect grafana-global-dashboard-llm:v1.7
```

Set the `FROM` line in the `Dockerfile` to the base image version you loaded. Then build a new image, choosing a new version tag (for example, `1.8`):

```powershell
cd C:\GrafanaDev\image-build
docker build --no-cache -t grafana-global-dashboard-llm:v1.8 .
```

Run the new image locally to test it:

```powershell
docker rm -f grafana-global-dashboard-llm-test
docker run -d --name grafana-global-dashboard-llm-test -p 3006:3000 grafana-global-dashboard-llm:v1.8
```

Open [http://localhost:3006](http://localhost:3006) and check the plugin.

## Deploy to Litmus Edge

Save the tested image as a tar archive:

```powershell
docker save -o C:\GrafanaDev\grafana-global-dashboard-llm-v1.8.tar grafana-global-dashboard-llm:v1.8
```

Use WinSCP to upload the archive to Litmus Edge. In **Applications > Images**, import it using the FTP option and select the uploaded archive.

In **Applications > Containers**, create and run a container from the imported image. For example:

```bash
docker run -d --name grafana-global-dashboard-llm -p 3005:3000 --restart always grafana-global-dashboard-llm:v1.8
```

If the container needs to join a Docker network, connect it from the `compose` container's terminal. Replace `<network-name>` with the network used by your deployment:

```bash
docker network connect <network-name> grafana-global-dashboard-llm
```

Confirm that the container has an IP address on that network.

## License

See [`uct-llmchat-panel/LICENSE`](uct-llmchat-panel/LICENSE).
