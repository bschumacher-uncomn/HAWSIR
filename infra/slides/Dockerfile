# The HAWSIR deck as a static site. Build context is the repo root:
#   docker build -f infra/slides/Dockerfile -t hawsir-slides .
# Slide images are rendered from the committed PDF here, so the repo only carries
# the deck files that python3 deck/build_week.py writes into docs/slides/.
FROM alpine:3.22 AS render
RUN apk add --no-cache poppler-utils jq
WORKDIR /site
COPY docs/slides/HAWSIR_this_week.pdf docs/slides/HAWSIR_this_week.pptx docs/slides/HAWSIR_this_week.notes.json ./
COPY infra/slides/site/ ./
RUN mv HAWSIR_this_week.notes.json notes.json \
 && mkdir slides thumbs \
 && pdftoppm -jpeg -jpegopt quality=88 -scale-to-x 1920 -scale-to-y 1080 HAWSIR_this_week.pdf slides/s \
 && pdftoppm -jpeg -jpegopt quality=80 -scale-to-x 480 -scale-to-y 270 HAWSIR_this_week.pdf thumbs/s \
 && for d in slides thumbs; do for f in "$d"/s-*.jpg; do \
      n="${f##*/s-}"; mv "$f" "$d/$(printf '%02d' "$(expr "${n%.jpg}" + 0)").jpg"; done; done \
 && pages="$(ls slides | wc -l)" && notes="$(jq '.slides | length' notes.json)" \
 && { [ "$pages" -eq "$notes" ] || { echo "PDF has $pages pages but notes.json has $notes slides" >&2; exit 1; }; }

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY --from=render /site /usr/share/nginx/html
EXPOSE 8080
