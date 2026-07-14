.PHONY: setup format lint test build migrate up down clean

PNPM := pnpm
SERVER_DIR := apps/server
BIN_DIR := bin

setup:
	corepack enable
	$(PNPM) install
	cd $(SERVER_DIR) && go mod tidy

format:
	cd $(SERVER_DIR) && gofmt -w .
	$(PNPM) run format

lint:
	cd $(SERVER_DIR) && golangci-lint run ./...
	$(PNPM) run lint

test:
	cd $(SERVER_DIR) && go test ./...
	$(PNPM) run test

build:
	mkdir -p $(BIN_DIR)
	cd $(SERVER_DIR) && go build -o ../../$(BIN_DIR)/api ./cmd/api
	cd $(SERVER_DIR) && go build -o ../../$(BIN_DIR)/game ./cmd/game
	cd $(SERVER_DIR) && go build -o ../../$(BIN_DIR)/migrate ./cmd/migrate
	$(PNPM) run build

migrate:
	mkdir -p $(BIN_DIR)
	cd $(SERVER_DIR) && go build -o ../../$(BIN_DIR)/migrate ./cmd/migrate
	./$(BIN_DIR)/migrate

up:
	docker compose up -d

down:
	docker compose down

clean:
	rm -rf $(BIN_DIR) apps/web/dist node_modules
