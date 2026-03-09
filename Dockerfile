FROM public.ecr.aws/lambda/nodejs:22
# FROM public.ecr.aws/amazonlinux/amazonlinux:2023

# Install git dependencies
RUN dnf update -y && \
    dnf install -y \
        openssl git git-lfs python3 python3-pip && \
    dnf clean all && \
    rm -rf /var/cache/dnf

# https://stackoverflow.com/a/77569212
RUN LD_LIBRARY_PATH="" pip install git-remote-s3

RUN git lfs install && \
    git config --global init.defaultBranch main && \
    git config --global user.email bot@static-chic.online && \
    git config --global user.name "bot@static-chic.online" && \
    git config --add --global lfs.customtransfer.git-lfs-s3.path git-lfs-s3 && \
    git config --add --global lfs.standalonetransferagent git-lfs-s3

# Lambda setup

COPY package.json package.json
COPY package-lock.json package-lock.json
RUN npm install -g npm@11.11.0 && \
    npm install --omit dev

COPY src/ src/

COPY handler.js ${LAMBDA_TASK_ROOT}
CMD [ "handler.handler" ]
