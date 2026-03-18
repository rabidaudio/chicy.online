# [static-chic.online](https://static-chic.online)

A multi-tenant static site host. Sites are stored in S3 buckets and served via CloudFront. Supports custom domains and arbitrary rollbacks.

```bash
npm run publish # deploy
npx sls logs -f api # show logs
```

## Development

```bash
pipx install git-remote-s3
```

# TODO


- cleanup
  - fix circular dependency issue in CF
- production deploy
  - callback url
  - cli env var configuration
  - https://github.com/settings/apps/static-chic-online
- new features
  - refactor cli
  - json vs text outputs from cli
  - automatic invalidation via path hashing
    - .chic.config file for ignores and keeps
  - rollback -n 1
  - admin cli
  - user caps
- frontend
- Custom deployments
  - solution for env vars in cli - esbuild
  - flag for private-only in sls to disable github logins
  - cleanup admin cli
