FROM public.ecr.aws/lambda/nodejs:24
# FROM public.ecr.aws/amazonlinux/amazonlinux:2023

# https://stackoverflow.com/a/77569212
ENV LD_LIBRARY_PATH=""

# Install git dependencies
RUN dnf update -y && \
    dnf install -y \
        openssl git git-lfs python3 python3-pip && \
    dnf clean all && \
    rm -rf /var/cache/dnf

RUN pip install git-remote-s3 && \
    git lfs install

# Lambda setup

COPY package.json package.json
COPY package-lock.json package-lock.json
RUN npm install -g npm@11.11.0 && \
    npm install --omit dev

COPY src/ ${LAMBDA_TASK_ROOT}/src/

COPY dist/s3_handler.js ${LAMBDA_TASK_ROOT}
CMD [ "s3_handler.deployHandler" ]
