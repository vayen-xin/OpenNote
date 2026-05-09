FROM eclipse-temurin:17-jre

RUN sed -i 's|http://archive.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g; s|http://security.ubuntu.com/ubuntu|https://mirrors.tuna.tsinghua.edu.cn/ubuntu|g' /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/opennote-venv \
    && /opt/opennote-venv/bin/pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn --upgrade pip setuptools wheel \
    && /opt/opennote-venv/bin/pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple --trusted-host pypi.tuna.tsinghua.edu.cn PyMuPDF Pillow requests urllib3

WORKDIR /app

COPY backend-0.0.1-SNAPSHOT.jar /app/app.jar
COPY agent /opt/opennote-agent

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
