# Firestore API — build & deploy helpers
# Recipes run under cmd.exe so behavior is identical in Git Bash and
# PowerShell. The only extra tool needed is `node` (reads the version).

PROJECT_ID ?= apilearn-512c2
REGION ?= us-central1
SERVICE_NAME ?= apilearn
REGISTRY ?= us-central1-docker.pkg.dev/$(PROJECT_ID)/apilearn

.PHONY: build build-local deploy publish run clean

SHELL := cmd.exe

VERSION := $(shell node scripts/version.cjs)
IMAGE := $(REGISTRY)/$(SERVICE_NAME)

build:
	gcloud builds submit \
		--config deploy/cloudbuild.yaml \
		--project $(PROJECT_ID) \
		--substitutions=_VERSION=$(VERSION)

build-local:
	docker buildx build \
		--platform linux/amd64 \
		-t $(IMAGE):$(VERSION) \
		-t $(IMAGE):latest \
		-f Dockerfile \
		--push \
		.

# The URL is public: Firebase ID tokens gate every data route (see readme).
deploy:
	gcloud run deploy $(SERVICE_NAME) \
		--image $(IMAGE):latest \
		--platform managed \
		--region $(REGION) \
		--port 8080 \
		--project $(PROJECT_ID) \
		--allow-unauthenticated

publish: build deploy

run:
	docker run --rm -p 3000:8080 -v "$(subst \,/,$(CURDIR))/serviceAccountKey.json:/app/serviceAccountKey.json" $(IMAGE):latest

clean:
	-docker rmi $(IMAGE):latest
