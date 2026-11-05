{{- define "hawsir.labels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/part-of: hawsir
{{- end }}

{{- define "hawsir.selector" -}}
app.kubernetes.io/name: {{ .component }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end }}

{{- define "hawsir.nodeId" -}}
{{- if .Values.node.id -}}{{ .Values.node.id }}{{- else if eq .Values.node.kind "shore" -}}shore{{- else -}}ship-{{ lower .Values.node.ship }}{{- end -}}
{{- end }}

{{- define "hawsir.llmUrl" -}}
{{- if .Values.llm.inCluster.enabled -}}
http://{{ .Release.Name }}-narrator.{{ .Release.Namespace }}.svc:8000/v1
{{- else -}}
{{ .Values.llm.url }}
{{- end -}}
{{- end }}
