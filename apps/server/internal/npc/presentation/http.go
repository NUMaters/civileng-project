package presentation

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/NUMaters/civileng-project/apps/server/internal/npc/application"
)

const maxRequestBytes = 2048

func Register(mux *http.ServeMux, service *application.Service) {
	mux.HandleFunc("POST /api/npc/conversations", func(w http.ResponseWriter, r *http.Request) {
		if !sameOrigin(w, r) {
			return
		}
		var request application.CreateRequest
		if !decode(w, r, &request) {
			return
		}
		result, err := service.Create(request)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusCreated, result)
	})
	mux.HandleFunc("POST /api/npc/conversations/{id}/answers", func(w http.ResponseWriter, r *http.Request) {
		if !sameOrigin(w, r) {
			return
		}
		var request application.QuestionRequest
		if !decode(w, r, &request) {
			return
		}
		result, err := service.Answer(r.Context(), r.PathValue("id"), token(r), request)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusOK, result)
	})
	mux.HandleFunc("DELETE /api/npc/conversations/{id}", func(w http.ResponseWriter, r *http.Request) {
		if !sameOrigin(w, r) {
			return
		}
		if err := service.Close(r.PathValue("id"), token(r)); err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
func token(r *http.Request) string {
	return strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
}
func sameOrigin(w http.ResponseWriter, r *http.Request) bool {
	if origin := r.Header.Get("Origin"); origin != "" {
		u, err := url.Parse(origin)
		if err != nil || u.Host != r.Host {
			respond(w, http.StatusForbidden, map[string]string{"code": "origin_rejected"})
			return false
		}
	}
	return true
}
func decode(w http.ResponseWriter, r *http.Request, target interface{}) bool {
	if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/json" {
		respond(w, http.StatusUnsupportedMediaType, map[string]string{"code": "json_required"})
		return false
	}
	reader := http.MaxBytesReader(w, r.Body, maxRequestBytes)
	decoder := json.NewDecoder(reader)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		respond(w, http.StatusBadRequest, map[string]string{"code": "invalid_request"})
		return false
	}
	var extra interface{}
	if err := decoder.Decode(&extra); err != io.EOF {
		respond(w, http.StatusBadRequest, map[string]string{"code": "invalid_request"})
		return false
	}
	return true
}
func respond(w http.ResponseWriter, status int, value interface{}) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, err error) {
	code, status := "unavailable", http.StatusInternalServerError
	var apiError *application.Error
	if errors.As(err, &apiError) {
		code, status = apiError.Code, http.StatusBadRequest
		switch code {
		case "invalid_conversation":
			status = http.StatusUnauthorized
		case "busy", "cooldown", "capacity":
			status = http.StatusTooManyRequests
		case "duplicate_request", "invalid_hint", "invalid_phase", "stale_request", "catalog_mismatch":
			status = http.StatusConflict
		case "disabled":
			status = http.StatusServiceUnavailable
		}
	}
	respond(w, status, map[string]string{"code": code})
}
