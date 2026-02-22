FROM python:3.11-slim

WORKDIR /app

# Install dependencies
RUN pip install --no-cache-dir fastapi uvicorn

# Copy mock server
COPY mock_server.py .

# Expose port
EXPOSE 9999

# Run the mock server
CMD ["uvicorn", "mock_server:app", "--host", "0.0.0.0", "--port", "9999"]
