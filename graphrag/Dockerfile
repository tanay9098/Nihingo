FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
COPY resources /resources
ENV RESOURCES_DIR=/resources PORT=8010
EXPOSE 8010
CMD ["python", "app.py"]
