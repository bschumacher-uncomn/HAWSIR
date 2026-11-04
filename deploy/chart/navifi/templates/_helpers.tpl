{{- define "navifi.labels" -}}
app.kubernetes.io/name: navifi
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/part-of: navifi
{{- end }}

{{- define "navifi.selector" -}}
app.kubernetes.io/name: navifi
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "navifi.llmUrl" -}}
{{- if .Values.llm.inCluster.enabled -}}
http://{{ .Release.Name }}-narrator.{{ .Release.Namespace }}.svc:8000/v1
{{- else -}}
{{ .Values.llm.url }}
{{- end -}}
{{- end }}
