# Death's toolbox. Built with internet access; runs only on the internal rig network.
FROM python:3.13-alpine
RUN apk add --no-cache curl bash zip ffuf hydra && pip install --no-cache-dir sqlmap==1.10.11
# ffuf's wordlist: SecLists' common web paths, pinned to a release tag (MIT licence).
ADD https://raw.githubusercontent.com/danielmiessler/SecLists/2025.3/Discovery/Web-Content/common.txt /wordlists/common.txt
RUN chmod 644 /wordlists/common.txt
WORKDIR /out
