# Go コーディング規約

必ず以下を実行する。

```
gofmt
goimports
```

`golangci-lint` を通すこと。

- `panic` 禁止。エラーは返す。

```go
return fmt.Errorf("...")
```

- Context を渡す。

```go
func (s *Service) Create(ctx context.Context)
```

- interface は必要になるまで作らない。

## 関連ドキュメント

- [コメント規約](./comments.md)
- [ログ規約](./logging.md)
- [エラーハンドリング](./error-handling.md)
