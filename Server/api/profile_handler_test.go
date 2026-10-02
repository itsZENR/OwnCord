package api_test

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/owncord/server/api"
	"github.com/owncord/server/db"
	"github.com/owncord/server/storage"
)

type profileEvent struct {
	userID   int64
	username string
	avatar   string
}

type profileEvents struct{ events []profileEvent }

func (p *profileEvents) BroadcastProfileUpdate(userID int64, username, avatar string) {
	p.events = append(p.events, profileEvent{userID, username, avatar})
}

func profileRouter(t *testing.T) (http.Handler, *db.DB, *storage.Storage, *profileEvents) {
	t.Helper()
	database := newChannelTestDB(t)
	store, err := storage.New(t.TempDir(), 1)
	if err != nil {
		t.Fatal(err)
	}
	events := &profileEvents{}
	r := chi.NewRouter()
	api.MountProfileRoutes(r, database, store, events)
	return r, database, store, events
}

func patchProfile(router http.Handler, token, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/me", bytes.NewBufferString(body))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rr := httptest.NewRecorder()
	router.ServeHTTP(rr, req)
	return rr
}

func TestUpdateProfileRenameAndConflict(t *testing.T) {
	router, database, _, events := profileRouter(t)
	token := chTestCreateToken(t, database, "Alice", 4)
	chTestCreateToken(t, database, "Bob", 4)

	if rr := patchProfile(router, "", `{"username":"Alicia"}`); rr.Code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d", rr.Code)
	}
	if rr := patchProfile(router, token, `{"username":"B"}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("invalid name status = %d: %s", rr.Code, rr.Body.String())
	}
	if rr := patchProfile(router, token, `{"username":"bob"}`); rr.Code != http.StatusConflict {
		t.Fatalf("duplicate name status = %d: %s", rr.Code, rr.Body.String())
	}
	rr := patchProfile(router, token, `{"username":"Alicia"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("rename status = %d: %s", rr.Code, rr.Body.String())
	}
	var response struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil || response.Username != "Alicia" {
		t.Fatalf("rename response = %s, err = %v", rr.Body.String(), err)
	}
	stored, err := database.GetUserByID(response.ID)
	if err != nil || stored == nil || stored.Username != "Alicia" {
		t.Fatalf("stored profile = %+v, err = %v", stored, err)
	}
	if len(events.events) != 1 || events.events[0] != (profileEvent{response.ID, "Alicia", ""}) {
		t.Fatalf("broadcast events = %+v", events.events)
	}
}

func TestUpdateProfileAvatarAndRemoval(t *testing.T) {
	router, database, store, events := profileRouter(t)
	token := chTestCreateToken(t, database, "Alice", 4)
	imageData := new(bytes.Buffer)
	imageToUpload := image.NewRGBA(image.Rect(0, 0, 16, 16))
	imageToUpload.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(imageData, imageToUpload); err != nil {
		t.Fatal(err)
	}
	id := uuid.NewString()
	if err := store.Save(id, bytes.NewReader(imageData.Bytes())); err != nil {
		t.Fatal(err)
	}
	if err := database.CreateAttachment(id, "avatar.png", id, "image/png", int64(imageData.Len()), nil, nil); err != nil {
		t.Fatal(err)
	}
	path := "/api/v1/files/" + id
	for _, bad := range []string{`{"avatar":"https://elsewhere/avatar.png"}`, `{"avatar":"/api/v1/files/` + uuid.NewString() + `"}`} {
		if rr := patchProfile(router, token, bad); rr.Code != http.StatusBadRequest {
			t.Fatalf("invalid avatar status = %d: %s", rr.Code, rr.Body.String())
		}
	}
	rr := patchProfile(router, token, `{"avatar":"`+path+`"}`)
	if rr.Code != http.StatusOK {
		t.Fatalf("avatar status = %d: %s", rr.Code, rr.Body.String())
	}
	var response struct {
		ID     int64   `json:"id"`
		Avatar *string `json:"avatar"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &response); err != nil || response.Avatar == nil || *response.Avatar != path {
		t.Fatalf("avatar response = %s, err = %v", rr.Body.String(), err)
	}
	if rr = patchProfile(router, token, `{"avatar":""}`); rr.Code != http.StatusOK {
		t.Fatalf("remove avatar status = %d: %s", rr.Code, rr.Body.String())
	}
	stored, err := database.GetUserByID(response.ID)
	if err != nil || stored == nil || stored.Avatar != nil {
		t.Fatalf("stored avatar = %+v, err = %v", stored, err)
	}
	if len(events.events) != 2 || events.events[0].avatar != path || events.events[1].avatar != "" {
		t.Fatalf("broadcast events = %+v", events.events)
	}
}
