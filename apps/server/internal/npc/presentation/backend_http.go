package presentation

import (
	"crypto/subtle"
	"net/http"
	"strings"

	"github.com/NUMaters/civileng-project/apps/server/internal/npc/application"
	"github.com/NUMaters/civileng-project/apps/server/internal/npc/domain"
)

// RegisterBackend exposes the private, stateless Main Backend -> NPC Backend API.
func RegisterBackend(mux *http.ServeMux, generator *application.Generator, expectedToken string) {
	mux.HandleFunc("POST /internal/v1/npc/answers", func(w http.ResponseWriter, r *http.Request) {
		if !authorizedBackendRequest(r, expectedToken) {
			respond(w, http.StatusUnauthorized, map[string]string{"code": "unauthorized"})
			return
		}
		var request domain.GenerationRequest
		if !decode(w, r, &request) {
			return
		}
		result, err := generator.Generate(r.Context(), request)
		if err != nil {
			fail(w, err)
			return
		}
		respond(w, http.StatusOK, result)
	})
}

func authorizedBackendRequest(r *http.Request, expectedToken string) bool {
	if expectedToken == "" {
		return true
	}
	actual := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	return len(actual) == len(expectedToken) && subtle.ConstantTimeCompare([]byte(actual), []byte(expectedToken)) == 1
}
