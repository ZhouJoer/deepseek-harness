ARG BASE_IMAGE
FROM ${BASE_IMAGE}
USER root
WORKDIR /opt/dsh-offline
COPY node_modules ./node_modules
COPY browser.mjs ./browser.mjs
ARG CHROMIUM_PATH=/usr/bin/google-chrome
ENV DSH_CHROMIUM_PATH=${CHROMIUM_PATH}
RUN python3 --version && node --version
USER 65534:65534
