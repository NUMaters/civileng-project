# エラーハンドリング

`errors.New()` または `fmt.Errorf()` を使用する。エラーは Wrap する。

```go
fmt.Errorf("load map: %w", err)
```
