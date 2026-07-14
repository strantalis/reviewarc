package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"log"
	"net/http"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	macoptions "github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS
var frontendRevision = embeddedFrontendRevision()

func embeddedFrontendRevision() string {
	index, err := assets.ReadFile("frontend/dist/index.html")
	if err != nil {
		return "unavailable"
	}
	sum := sha256.Sum256(index)
	return hex.EncodeToString(sum[:8])
}

func preventFrontendCaching(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store, max-age=0")
		response.Header().Set("Pragma", "no-cache")
		response.Header().Set("Expires", "0")
		if request.URL.Path == "/__frontend/"+frontendRevision+"/" {
			request = request.Clone(request.Context())
			request.URL.Path = "/"
		}
		next.ServeHTTP(response, request)
	})
}

func main() {
	app, err := NewApp()
	if err != nil {
		log.Fatal(err)
	}
	err = wails.Run(applicationOptions(app))
	if err != nil {
		log.Fatal(err)
	}
}

func applicationOptions(app *App) *options.App {
	return &options.App{
		Title:       "ReviewArc",
		Width:       1440,
		Height:      900,
		MinWidth:    1024,
		MinHeight:   700,
		Frameless:   false,
		AssetServer: &assetserver.Options{Assets: assets, Middleware: preventFrontendCaching},
		Mac:         &macoptions.Options{TitleBar: macoptions.TitleBarHidden()},
		OnStartup:   app.startup,
		OnDomReady:  app.domReady,
		OnShutdown:  app.shutdown,
		Bind:        []interface{}{app},
	}
}
