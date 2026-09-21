{{- define "logsy.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "logsy.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := include "logsy.name" . -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "logsy.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "logsy.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "logsy.secretName" -}}
{{- default (printf "%s-secrets" (include "logsy.fullname" .)) .Values.existingSecret -}}
{{- end -}}

{{/* One image per app, all sharing a registry and a tag. */}}
{{- define "logsy.image" -}}
{{- $tag := default .root.Chart.AppVersion .root.Values.image.tag -}}
{{- printf "%s/logsy-%s:%s" (trimSuffix "/" .root.Values.image.registry) .component $tag -}}
{{- end -}}

{{/*
Environment shared by every app. Secret keys are optional on purpose: a key that is
absent simply leaves the variable unset, and the app reports what it is missing.
*/}}
{{- define "logsy.commonEnv" -}}
- name: NODE_ENV
  value: production
- name: LOG_LEVEL
  value: {{ .Values.config.logLevel | quote }}
- name: DATABASE_URL
  valueFrom:
    configMapKeyRef:
      name: {{ include "logsy.fullname" . }}
      key: DATABASE_URL
- name: REDIS_URL
  valueFrom:
    configMapKeyRef:
      name: {{ include "logsy.fullname" . }}
      key: REDIS_URL
{{- if .Values.config.sentryDsn }}
- name: SENTRY_DSN
  value: {{ .Values.config.sentryDsn | quote }}
{{- end }}
{{- if .Values.config.otlpEndpoint }}
- name: OTEL_EXPORTER_OTLP_ENDPOINT
  value: {{ .Values.config.otlpEndpoint | quote }}
{{- end }}
{{- end -}}

{{- define "logsy.secretEnv" -}}
{{- $keys := list "GITHUB_WEBHOOK_SECRET" "GITHUB_APP_ID" "GITHUB_PRIVATE_KEY" "AUTH_SECRET" "AUTH_GITHUB_ID" "AUTH_GITHUB_SECRET" "ANTHROPIC_API_KEY" "OPENAI_API_KEY" "GROQ_API_KEY" "GEMINI_API_KEY" -}}
{{- range $keys }}
- name: {{ . }}
  valueFrom:
    secretKeyRef:
      name: {{ include "logsy.secretName" $ }}
      key: {{ . }}
      optional: true
{{- end }}
{{- end -}}
