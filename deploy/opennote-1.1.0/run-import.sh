#!/bin/sh
curl -sS -X POST -F file=@/opt/opennode1.1.0/opennote-import.v1.referenced.zip http://127.0.0.1:8081/api/imports/question-bank > /tmp/opennote-import.out 2> /tmp/opennote-import.err
