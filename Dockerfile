FROM python:3.13-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV NODE_ENV=production
ENV DATABASE_URL="file:../paudio.db"

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    git \
    ffmpeg \
    build-essential \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /paudio

# Install Python dependencies
COPY requirements.txt .
RUN python3 -m venv .venv
ENV PATH="/paudio/.venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cu128

# Install Node dependencies
COPY app/package.json app/package-lock.json ./app/
WORKDIR /paudio/app
# We run npm ci with --include=dev so we have typescript, prisma etc. for building
RUN npm ci --include=dev

# Copy all files
WORKDIR /paudio
COPY . .

# Build the Next.js app
WORKDIR /paudio/app
RUN npx prisma generate
RUN npm run build

# Expose Next.js default port from package.json
EXPOSE 5600

# Start Next.js
CMD ["npm", "run", "start"]
