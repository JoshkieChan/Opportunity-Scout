FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --create-home app
COPY --chown=app:app *.py ./validator/
USER app
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "validator.main:app", "--host", "0.0.0.0", "--port", "8000"]
