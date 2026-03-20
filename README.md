# chicy.online

A multi-tenant static site host. Sites are stored in S3 buckets and served via CloudFront. Supports custom domains and arbitrary rollbacks.

```bash
npm install -g chicy

chicy init # login with Github and create a site
chicy deploy --promote --wait path/to/dist # publish data
chicy configure --domain mydomain.com # set up a custom domain
```
