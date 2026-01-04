#!/bin/bash
# deploy.sh

echo "🚀 Deploying MyGov Content Extractor..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found. Please copy .env.example to .env and configure it."
    exit 1
fi

# Load environment safely (supports spaces/quotes)
set -a
. ./.env
set +a

# Track optional flags
RUN_CRAWL=false
RUN_AI_EVALS=${ENABLE_AI_EVALS_PIPELINE:-${ENABLE_EVALS_PIPELINE:-false}}
RUN_SEO_EVALS=${ENABLE_SEO_EVALS_PIPELINE:-false}

for arg in "$@"; do
    case "$arg" in
        --crawl)
            RUN_CRAWL=true
            ;;
        --with-evals|--with-ai-evals)
            RUN_AI_EVALS=true
            ;;
        --with-seo-evals)
            RUN_SEO_EVALS=true
            ;;
        --with-all-evals)
            RUN_AI_EVALS=true
            RUN_SEO_EVALS=true
            ;;
        --help|-h)
            echo "Usage: ./deploy.sh [--crawl] [--with-evals] [--with-seo-evals] [--with-all-evals]"
            echo "  --crawl            Run the unified scraper once after services start"
            echo "  --with-evals       Install lightweight AI eval deps (or set ENABLE_AI_EVALS_PIPELINE=true)"
            echo "  --with-seo-evals   Install SEO/Google capture deps (or set ENABLE_SEO_EVALS_PIPELINE=true)"
            echo "  --with-all-evals   Convenience flag to install both"
            exit 0
            ;;
        *)
            echo "❌ Unknown option: $arg"
            echo "Usage: ./deploy.sh [--crawl] [--with-evals] [--with-seo-evals] [--with-all-evals]"
            exit 1
            ;;
    esac
done

# Build images
echo "🔨 Building Docker images..."
docker-compose build

# Start services (conditionally include LiteLLM)
echo "🐳 Starting services..."
if [ "${ENABLE_LITELLM:-false}" = "true" ]; then
    echo "  📡 LiteLLM enabled - starting with unified AI routing"
    docker-compose --profile litellm up -d
else
    echo "  🦙 LiteLLM disabled - using direct provider calls"
    docker-compose up -d
fi

# Wait for Typesense to be ready
echo "⏳ Waiting for Typesense..."
max_attempts=30
attempt=0
until curl -s http://localhost:8108/health | grep -q "ok"; do
  attempt=$((attempt + 1))
  if [ $attempt -eq $max_attempts ]; then
    echo "❌ Typesense failed to start after $max_attempts attempts"
    exit 1
  fi
  echo "  Attempt $attempt/$max_attempts..."
  sleep 2
done

echo "✅ Typesense is ready"

# Optionally prepare AI eval dependencies
if [ "$RUN_AI_EVALS" = "true" ]; then
    echo "🧪 Preparing AI eval (agentic) dependencies..."
    if [ -d evals/node_modules ]; then
        echo "  ✅ evals/node_modules already exists - skipping npm install"
    else
        (cd evals && npm install)
        if [ $? -ne 0 ]; then
            echo "❌ Failed to install AI eval dependencies"
            exit 1
        fi
    fi
else
    echo "🧪 AI eval pipeline skipped (enable with --with-evals or set ENABLE_AI_EVALS_PIPELINE=true)"
fi

# Optionally prepare SEO/Google capture dependencies
if [ "$RUN_SEO_EVALS" = "true" ]; then
    echo "🌐 Preparing SEO / Google Search capture dependencies..."
    if [ -d evals/google-search/node_modules ]; then
        echo "  ✅ evals/google-search/node_modules already exists - skipping npm install"
    else
        (cd evals/google-search && npm install)
        if [ $? -ne 0 ]; then
            echo "❌ Failed to install SEO eval dependencies"
            exit 1
        fi
    fi
else
    echo "🌐 SEO / Google Search eval pipeline skipped (enable with --with-seo-evals or set ENABLE_SEO_EVALS_PIPELINE=true)"
fi

# Check if we should run initial crawl
if [ "$RUN_CRAWL" = "true" ]; then
    echo "🕷️ Starting initial crawl..."
    docker-compose run --rm scraper
fi

echo "✨ Deployment complete!"
echo "📊 API available at http://localhost:3000"
echo "🔍 Typesense dashboard at http://localhost:8108"
if [ "${ENABLE_LITELLM:-false}" = "true" ]; then
    echo "📡 LiteLLM unified AI router at http://localhost:4000"
fi
echo ""
echo "Next steps:"
echo "  - Run initial crawl: docker-compose run --rm scraper"
echo "  - Check API health: curl http://localhost:3000/health"
echo "  - Test AI models: curl http://localhost:3000/api/llm/models"
if [ "${ENABLE_LITELLM:-false}" = "true" ]; then
    echo "  - Check LiteLLM health: curl http://localhost:4000/health"
fi
echo "  - View logs: docker-compose logs -f"
