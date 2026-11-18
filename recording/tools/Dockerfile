# Death's toolbox. Built with internet access; runs only on the internal rig network.
FROM python:3.13-alpine
RUN apk add --no-cache curl bash && pip install --no-cache-dir sqlmap==1.10.11
WORKDIR /out
