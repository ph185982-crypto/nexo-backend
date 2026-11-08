#!/bin/sh
# Gera public/extensao-avanteza-whatsapp.zip a partir de extensao/ (o CRM serve o arquivo para download).
# Rode depois de mudar qualquer arquivo da extensão; tests/conversas.test.ts falha se o zip ficar desatualizado.
set -e
cd "$(dirname "$0")/.."
rm -f public/extensao-avanteza-whatsapp.zip
(cd extensao && zip -q -X -r ../public/extensao-avanteza-whatsapp.zip manifest.json background.js content.js leitura.js opcoes.html opcoes.js icone-16.png icone-48.png icone-128.png)
echo "public/extensao-avanteza-whatsapp.zip"
