# ブランチ保護設定手順

`main` と `develop` への直接 Push を防ぎ、Pull Request 経由のマージを強制する。

関連 Issue: [#22](https://github.com/NUMaters/civileng-project/issues/22)

---

## 現状

| 項目                   | 状態                                                  |
| ---------------------- | ----------------------------------------------------- |
| `develop` ブランチ     | 作成済み                                              |
| `main` ブランチ        | 存在                                                  |
| Branch Protection Rule | **未設定**（管理者が GitHub Settings で有効化が必要） |

---

## 設定手順

GitHub リポジトリの **Settings → Branches → Branch protection rules** で以下を設定する。

### main / develop 共通

| 設定                                             | 値                                 |
| ------------------------------------------------ | ---------------------------------- |
| Require a pull request before merging            | ✅                                 |
| Required approvals                               | 1                                  |
| Require status checks to pass before merging     | ✅                                 |
| Status checks                                    | `Lint, Test, Build`（CI workflow） |
| Require branches to be up to date before merging | ✅                                 |
| Do not allow bypassing the above settings        | ✅（管理者含む）                   |
| Allow force pushes                               | ❌                                 |
| Allow deletions                                  | ❌                                 |

### 保護対象ブランチ

```
main
develop
```

---

## 確認方法

```bash
# develop の保護状態を確認（404 = 未設定）
gh api repos/NUMaters/civileng-project/branches/develop/protection

# main の保護状態を確認
gh api repos/NUMaters/civileng-project/branches/main/protection
```

保護設定後は `required_pull_request_reviews` 等の JSON が返る。

---

## 関連ドキュメント

- [ブランチ運用規則](./branch-strategy.md)
- [Pull Request](./pull-request.md)
