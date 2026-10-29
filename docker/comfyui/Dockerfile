# syntax=docker/dockerfile:1
# Telios's own ComfyUI, for a Telios that runs standalone (no COMFYUI_API_URL): ComfyUI with the
# GGUF loader, drawing with FLUX.1 Dev (quantized). The same image as Phansora's
# (phansora/docker/comfyui). Model files are not baked in: they are fetched once into a mounted
# folder (fetch_models.py), about 12 GB.

FROM python:3.12-slim-bookworm

# Pinned so a rebuild next year produces the same thing. Change them in .env.
ARG COMFYUI_REF=v0.39.0
ARG COMFYUI_GGUF_REF=6ea2651e7df66d7585f6ffee804b20e92fb38b8a
# PyTorch build: cu126 suits most NVIDIA drivers; use .../whl/cpu for no GPU.
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cu126

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp

ADD https://github.com/Comfy-Org/ComfyUI/archive/${COMFYUI_REF}.tar.gz /tmp/comfyui.tar.gz
ADD https://github.com/city96/ComfyUI-GGUF/archive/${COMFYUI_GGUF_REF}.tar.gz /tmp/gguf.tar.gz
RUN mkdir -p /opt/ComfyUI /opt/ComfyUI/custom_nodes/ComfyUI-GGUF \
 && tar -xzf /tmp/comfyui.tar.gz --strip-components=1 -C /opt/ComfyUI \
 && tar -xzf /tmp/gguf.tar.gz --strip-components=1 -C /opt/ComfyUI/custom_nodes/ComfyUI-GGUF \
 && rm /tmp/comfyui.tar.gz /tmp/gguf.tar.gz

WORKDIR /opt/ComfyUI
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install torch torchvision torchaudio --index-url ${TORCH_INDEX_URL} \
 && pip install -r requirements.txt -r custom_nodes/ComfyUI-GGUF/requirements.txt

COPY fetch_models.py /opt/comfyui-setup/fetch_models.py
COPY entrypoint.sh /usr/local/bin/comfyui-entrypoint
RUN chmod +x /usr/local/bin/comfyui-entrypoint

EXPOSE 8188
ENTRYPOINT ["comfyui-entrypoint"]
