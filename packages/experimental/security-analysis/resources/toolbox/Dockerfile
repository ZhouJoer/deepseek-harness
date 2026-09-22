ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends python3 curl nuclei metasploit-framework john libcrypt1 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY inspect.py /opt/dsh-toolbox/inspect.py
RUN python3 /opt/dsh-toolbox/inspect.py 120 > /opt/dsh-toolbox/manifest.json
WORKDIR /workspace
ENTRYPOINT ["sleep", "infinity"]
