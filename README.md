# Áudios prontos das aulas (PMGO)

Branch só de dados: os MP3 de cada aula e o `manifest.json` que o app usa.
Não tem código e não é publicada pela Vercel (`vercel.json` desliga o deploy).

Gerado por `scripts/gerar_audios.py` (branch master). O nome de cada arquivo
leva o hash do roteiro: conteúdo novo gera arquivo novo, e o celular não
toca áudio velho do cache.
