# chicy.online

A multi-tenant static site host. Sites are stored in S3 buckets and served via CloudFront. Supports custom domains and arbitrary rollbacks.

## Read [the blog post](https://rabid.audio/software/2026/03/27/introducing-chicy-online/) for more

```bash
npm install -g chicy.online

chicy init # login with Github and create a site
chicy deploy path/to/dist --promote --wait # publish data
chicy configure --domain mydomain.com # set up a custom domain
```
