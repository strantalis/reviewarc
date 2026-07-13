package main

import (
	"embed"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	macoptions "github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

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
		AssetServer: &assetserver.Options{Assets: assets},
		Mac:         &macoptions.Options{TitleBar: macoptions.TitleBarHidden()},
		OnStartup:   app.startup,
		OnDomReady:  app.domReady,
		OnShutdown:  app.shutdown,
		Bind:        []interface{}{app},
	}
}
