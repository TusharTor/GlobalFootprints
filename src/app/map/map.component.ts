import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, NgZone, OnInit } from '@angular/core';
import { GoogleMap, GoogleMapsModule } from '@angular/google-maps';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

interface LocationData {
    ResolvedCountry: string;
    country?: string;
    id?: number;
    name?: string;
    Country?: string;
    Name?: string;
    title?: string;
    Latitude: number;
    Longitude: number;
}

interface CityMarker {
    id: number;
    position: google.maps.LatLngLiteral;
    title: string;
    country: string;
    ResolvedCountry?: string;
}

type ZoneName =
    | 'India'
    | 'Middle East - Africa'
    | 'Europe'
    | 'South East Asia'
    | 'US'
    | 'Latin America'
    | 'Australia-NewZealand'
    | 'FarEast';
type ZoneFilter = 'All Zones' | ZoneName;

type PointThemeMode = 'current' | 'tor-control-room' | 'signal-grid-teal' | 'light-atlas' | 'intensity-map' | 'photograph-density';
type ThemeMode = PointThemeMode | 'heatmap';

@Component({
    selector: 'app-map',
    templateUrl: './map.component.html',
    styleUrl: './map.component.scss',
    standalone: true,
    imports: [CommonModule, GoogleMapsModule]
})
export class MapComponent implements OnInit {
    readonly defaultThemeZoom = 3;
    readonly defaultCenter: google.maps.LatLngLiteral = {
        lat: 20,
        lng: 20
    };

    zoom = this.defaultThemeZoom;
    readonly labelZoomThreshold = 7;
    currentZoom = this.zoom;

    center: google.maps.LatLngLiteral = this.defaultCenter;
    apiLoaded = false;
    apiLoadError = '';
    selectedMarker?: CityMarker;
    themeMode: ThemeMode = 'photograph-density';
    // Keep Latin America hidden from the UI list while still supporting it in filtering logic.
    readonly zones: ZoneName[] = ['India', 'Middle East - Africa', 'Europe', 'South East Asia', 'US', 'Australia-NewZealand', 'FarEast'];
    selectedZone: ZoneFilter = 'All Zones';

    private mapInstance?: google.maps.Map;
    private googleMarkers: google.maps.Marker[] = [];
    private markerMap = new Map<google.maps.Marker, CityMarker>();
    private cachedIcon?: google.maps.Icon;
    private cachedTorControlRoomIcon?: google.maps.Icon;
    private cachedHollowOrangeCircleIcon?: google.maps.Icon;
    private cachedSignalGridIcon?: google.maps.Icon;
    private cachedLightAtlasIcon?: google.maps.Icon;
    private cachedHeatmapIcon?: google.maps.Icon;
    private mapDataLayer?: google.maps.Data;
    private heatmapGeoJsonLoaded = false;
    private countryPointCounts: Record<string, number> = {}; private countryLabelInfos: CountryLabelInfo[] = [];
    private countryLabelMarkerMap = new Map<string, google.maps.Marker>();
    private countryLabelMarkers: google.maps.Marker[] = [];
    private locationData: LocationData[] = [];
    private allLandLocations: LocationData[] = [];
    heatmapLoading = false;
    private labelProjectionOverlay?: google.maps.OverlayView;
    private labelIdleListener?: google.maps.MapsEventListener;
    private measureCanvasCtx?: CanvasRenderingContext2D;
    private countryCentroids: Record<string, { lat: number; lng: number; count: number }> = {};
    private readonly countriesGeoJsonUrl = 'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/countries.geojson';

    private readonly currentMapStyles: google.maps.MapTypeStyle[] = [
        {
            elementType: 'geometry',
            stylers: [{ color: '#111827' }]
        },
        {
            elementType: 'labels.text.stroke',
            stylers: [{ color: '#111827' }]
        },
        {
            elementType: 'labels.text.fill',
            stylers: [{ color: '#9ca3af' }]
        },
        {
            featureType: 'administrative',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'poi',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'transit',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'road',
            elementType: 'geometry',
            stylers: [{ color: '#1f2937' }]
        },
        {
            featureType: 'water',
            elementType: 'geometry',
            stylers: [{ color: '#1E1E1E' }]
        },
        {
            featureType: 'water',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'water',
            elementType: 'labels.icon',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'island',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'landscape',
            elementType: 'geometry',
            stylers: [{ color: '#5A5652' }]
        },
        {
            featureType: 'administrative.country',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'administrative.province',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'landscape',
            elementType: 'geometry.stroke',
            stylers: [{ visibility: 'off' }]
        }
    ];

    private readonly heatmapMapStyles: google.maps.MapTypeStyle[] = [
        {
            elementType: 'geometry',
            stylers: [{ color: '#fcf7f7' }]
        },
        {
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'water',
            elementType: 'geometry',
            stylers: [{ color: '#1E1E1E' }]
        },
        {
            featureType: 'landscape',
            elementType: 'geometry',
            stylers: [{ color: '#5A5652' }]
        },
        {
            featureType: 'island',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'road',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'poi',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'transit',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'administrative.country',
            elementType: 'geometry.stroke',
            stylers: [{ color: '#0f0f0f' }, { weight: 1.05 }]
        },
        {
            featureType: 'administrative.country',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        }
    ];

    private readonly intensityMapMapStyles: google.maps.MapTypeStyle[] = [
        {
            elementType: 'geometry',
            stylers: [{ color: '#0a0a0a' }]
        },
        {
            featureType: 'island',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            elementType: 'labels.text.stroke',
            stylers: [{ color: '#0a0a0a' }]
        },
        {
            elementType: 'labels.text.fill',
            stylers: [{ color: '#fbbf24' }]
        },
        {
            featureType: 'administrative',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'poi',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'transit',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'road',
            elementType: 'geometry',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'water',
            elementType: 'geometry',
            stylers: [{ color: '#2a1a3a' }]
        },
        {
            featureType: 'water',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'water',
            elementType: 'labels.icon',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'landscape',
            elementType: 'geometry',
            stylers: [{ color: '#d7e1eb' }]
        },
        {
            featureType: 'administrative.country',
            elementType: 'geometry.stroke',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'administrative.country',
            stylers: [{ visibility: 'off' }]
        }
    ];

    private readonly photographDensityMapStyles: google.maps.MapTypeStyle[] = [
        {
            elementType: 'geometry',
            stylers: [{ color: '#0a0a0a' }]
        },
        {
            elementType: 'labels.text.stroke',
            stylers: [{ color: '#0a0a0a' }]
        },
        {
            featureType: 'island',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            elementType: 'labels.text.fill',
            stylers: [{ color: '#070707' }]
        },
        {
            featureType: 'administrative',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'poi',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'transit',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'road',
            elementType: 'geometry',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'water',
            elementType: 'geometry',
            stylers: [{ color: '#1E1E1E' }]
        },
        {
            featureType: 'water',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'water',
            elementType: 'labels.icon',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'landscape',
            elementType: 'geometry',
            stylers: [{ color: '#5A5652' }]
        },
        {
            featureType: 'administrative.country',
            elementType: 'geometry.stroke',
            stylers: [{ visibility: 'on' }, { weight: 1.1 }]
        },
        {
            featureType: 'administrative.country',
            stylers: [{ visibility: 'off' }]
        }
    ];

    private readonly torControlRoomMapStyles: google.maps.MapTypeStyle[] = [
        {
            elementType: 'geometry',
            stylers: [{ color: '#0b1220' }]
        },
        {
            elementType: 'labels.text.stroke',
            stylers: [{ color: '#0b1220' }]
        },
        {
            featureType: 'island',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            elementType: 'labels.text.fill',
            stylers: [{ color: '#9db3cc' }]
        },
        {
            featureType: 'administrative',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'road',
            elementType: 'geometry',
            stylers: [{ color: '#1b2a42' }]
        },
        {
            featureType: 'water',
            elementType: 'geometry',
            stylers: [{ color: '#111827' }]
        },
        {
            featureType: 'water',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'landscape',
            elementType: 'geometry',
            stylers: [{ color: '#4b4f54' }]
        },
        {
            featureType: 'poi',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'transit',
            stylers: [{ visibility: 'off' }]
        }
    ];

    private readonly signalGridTealMapStyles: google.maps.MapTypeStyle[] = [
        {
            elementType: 'geometry',
            stylers: [{ color: '#10151f' }]
        },
        {
            elementType: 'labels.text.stroke',
            stylers: [{ color: '#10151f' }]
        },
        {
            featureType: 'island',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            elementType: 'labels.text.fill',
            stylers: [{ color: '#8ab4c2' }]
        },
        {
            featureType: 'administrative',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'road',
            elementType: 'geometry',
            stylers: [{ color: '#1f2937' }]
        },
        {
            featureType: 'water',
            elementType: 'geometry',
            stylers: [{ color: '#0f172a' }]
        },
        {
            featureType: 'water',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'landscape',
            elementType: 'geometry',
            stylers: [{ color: '#2f3c45' }]
        },
        {
            featureType: 'poi',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'transit',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'island',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        }
    ];

    private readonly lightAtlasMapStyles: google.maps.MapTypeStyle[] = [
        {
            elementType: 'geometry',
            stylers: [{ color: '#f7fafc' }]
        },
        {
            featureType: 'island',
            elementType: 'labels.text',
            stylers: [{ visibility: 'off' }]
        },
        {
            elementType: 'labels.text.stroke',
            stylers: [{ color: '#f7fafc' }]
        },
        {
            elementType: 'labels.text.fill',
            stylers: [{ color: '#334155' }]
        },
        {
            featureType: 'administrative',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'road',
            elementType: 'geometry',
            stylers: [{ color: '#dce4ec' }]
        },
        {
            featureType: 'water',
            elementType: 'geometry',
            stylers: [{ color: '#b9d7f2' }]
        },
        {
            featureType: 'water',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'landscape',
            elementType: 'geometry',
            stylers: [{ color: '#e7edf3' }]
        },
        {
            featureType: 'administrative.country',
            elementType: 'geometry.stroke',
            stylers: [{ color: '#6e84a3' }, { weight: 1.1 }]
        },
        {
            featureType: 'poi',
            stylers: [{ visibility: 'off' }]
        },
        {
            featureType: 'transit',
            stylers: [{ visibility: 'off' }]
        }
    ];

    constructor(private http: HttpClient, private ngZone: NgZone) { }

    ngOnInit(): void {
        this.initializeMap();
    }

    onMapInitialized(map: google.maps.Map): void {
        this.mapInstance = map;
        this.currentZoom = map.getZoom() ?? this.currentZoom;
        this.mapInstance.addListener('zoom_changed', () => {
            this.ngZone.run(() => {
                const liveZoom = this.mapInstance?.getZoom();
                if (liveZoom === undefined || liveZoom === null) {
                    return;
                }
                this.currentZoom = liveZoom;
                // Keep Angular input zoom in sync with manual map interactions.
                this.zoom = liveZoom;
            });
        });
        this.updateViewport();
    }

    setTheme(mode: ThemeMode): void {
        if (this.themeMode === mode) {
            return;
        }

        this.themeMode = mode;
        this.applyThemeMode(mode);
    }

    onZoneDropdownChange(event: Event): void {
        const value = (event.target as HTMLSelectElement).value as ZoneFilter;
        this.setZone(value);
    }

    setZone(zone: ZoneFilter): void {
        if (this.selectedZone === zone) {
            return;
        }

        this.selectedZone = zone;
        this.rebuildMarkersForSelectedZone();
    }

    selectMarker(cityMarker: CityMarker): void {
        this.selectedMarker = cityMarker;
        this.center = cityMarker.position;

        if (this.mapInstance) {
            this.mapInstance.panTo(cityMarker.position);
        }
    }

    get markers() {
        return this.googleMarkers;
    }
    private ensureLabelProjectionOverlay(): void {
        if (this.labelProjectionOverlay) return;

        class ProjectionOverlay extends google.maps.OverlayView {
            override onAdd(): void { }
            override draw(): void { }
            override onRemove(): void { }
        }

        const overlay = new ProjectionOverlay();
        overlay.setMap(this.mapInstance!);
        this.labelProjectionOverlay = overlay;
    }

    private withProjection(cb: (projection: google.maps.MapCanvasProjection) => void): void {
        const projection = this.labelProjectionOverlay?.getProjection();
        if (projection) {
            cb(projection);
        } else {
            requestAnimationFrame(() => this.withProjection(cb));
        }
    }
    private measureLabelWidth(text: string, primary: boolean): number {
        if (!this.measureCanvasCtx) {
            this.measureCanvasCtx = document.createElement('canvas').getContext('2d')!;
        }
        const font = primary ? '700 6px "Barlow Condensed", "Arial Narrow", Arial, sans-serif' : '600 5px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
        this.measureCanvasCtx.font = font;
        const letterSpacing = primary ? 0.8 : 0.6;
        return this.measureCanvasCtx.measureText(text).width + text.length * letterSpacing;
    }

    private async initializeMap(): Promise<void> {
        if (!environment.googleMapsApiKey) {
            this.apiLoadError = 'Google Maps API key is not configured.';
            return;
        }

        try {
            await this.loadGoogleMapsApi();
            this.apiLoaded = true;
            this.loadLocations();
        } catch {
            this.apiLoadError = 'Google Maps could not be loaded.';
        }
    }

    mapOptions: google.maps.MapOptions = {
        zoom: this.defaultThemeZoom,
        center: { lat: 20, lng: 20 },
        disableDefaultUI: true,
        zoomControl: true,
        scrollwheel: true,
        gestureHandling: 'greedy',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        minZoom: 2,
        styles: this.currentMapStyles
    };

    private loadLocations(): void {
        this.http
            .get<LocationData[]>('assets/locations5.json')
            .subscribe({
                next: data => {
                    if (!this.mapInstance) return;

                    this.initializeMarkersWithLandOnly(data);
                }
            });
    }

    private async initializeMarkersWithLandOnly(data: LocationData[]): Promise<void> {
        if (!this.mapInstance) {
            return;
        }

        const validLocations = data.filter(location => this.isCoordinateValid(location));
        const landLocations = await this.removeSeaLocations(validLocations);

        this.allLandLocations = landLocations;
        this.rebuildMarkersForSelectedZone();
    }

    // private rebuildMarkersForSelectedZone(): void {
    //     if (!this.mapInstance) {
    //         return;
    //     }

    //     const filteredLocations = this.filterLocationsBySelectedZone(this.allLandLocations);
    //     this.locationData = filteredLocations;
    //     this.selectedMarker = undefined;
    //     this.googleMarkers.forEach(marker => marker.setMap(null));
    //     this.googleMarkers = [];
    //     this.markerMap.clear();

    //     const markerIcon = this.getPointThemeIcon(this.getActivePointTheme(this.themeMode));

    //     for (const [index, location] of filteredLocations.entries()) {
    //         const title = this.resolveLocationName(location, index + 1);
    //         const country = this.resolveLocationCountry(location);

    //         const marker = new google.maps.Marker({
    //             position: {
    //                 lat: location.Latitude,
    //                 lng: location.Longitude
    //             },
    //             title,
    //             icon: markerIcon
    //         });


    //         const cityMarker: CityMarker = {
    //             id: location.id ?? index + 1,
    //             position: marker.getPosition()!.toJSON(),
    //             title,
    //             country
    //         };

    //         this.markerMap.set(marker, cityMarker);
    //         this.googleMarkers.push(marker);

    //         marker.addListener('click', () => {
    //             this.ngZone.run(() => {
    //                 this.selectMarker(cityMarker);
    //             });
    //         });

    //     }


    //     this.applyThemeMode(this.themeMode);
    // }
    private rebuildMarkersForSelectedZone(): void {
        console.log("rebuildMarkersForSelectedZone() called");
        if (!this.mapInstance) {
            return;
        }

        const filteredLocations = this.filterLocationsBySelectedZone(this.allLandLocations);
        this.locationData = filteredLocations;
        this.selectedMarker = undefined;
        this.googleMarkers.forEach(marker => marker.setMap(null));
        this.googleMarkers = [];
        this.markerMap.clear();

        const markerIcon = this.getPointThemeIcon(this.getActivePointTheme(this.themeMode));

        for (const [index, location] of filteredLocations.entries()) {

            // 👇 Add this
            console.log(
                'Location:',
                location.Latitude,
                location.Longitude,
                'ResolvedCountry =',
                location.ResolvedCountry
            );

            const title = this.resolveLocationName(location, index + 1);
            const country = this.resolveLocationCountry(location);

            // 👇 Add this
            console.log('Country used for marker =', country);

            const marker = new google.maps.Marker({
                position: {
                    lat: location.Latitude,
                    lng: location.Longitude
                },
                title,
                icon: markerIcon
            });

            const cityMarker: CityMarker = {
                id: location.id ?? index + 1,
                position: marker.getPosition()!.toJSON(),
                title,
                country
            };

            this.markerMap.set(marker, cityMarker);
            this.googleMarkers.push(marker);

            marker.addListener('click', () => {
                this.ngZone.run(() => {
                    console.log('Clicked marker:', cityMarker);
                    this.selectMarker(cityMarker);
                });
            });
        }

        this.applyThemeMode(this.themeMode);
    }

    private filterLocationsBySelectedZone(locations: LocationData[]): LocationData[] {
        if (this.selectedZone === 'All Zones') {
            return locations;
        }

        return locations.filter(location => this.resolveLocationZone(location) === this.selectedZone);
    }

    private resolveLocationZone(location: LocationData): ZoneName | null {
        const country = this.resolveLocationCountry(location).trim();
        const countryZone = this.getZoneFromCountry(country);
        if (countryZone) {
            return countryZone;
        }

        return this.getZoneFromCoordinates(location.Latitude, location.Longitude);
    }

    private getZoneFromCountry(country: string): ZoneName | null {
        if (!country || country === 'Unknown Region') {
            return null;
        }

        const normalized = country.toLowerCase();

        const countryToZone: Record<string, ZoneName> = {
            'united states': 'US',
            usa: 'US',
            'united states of america': 'US',
            canada: 'US',
            mexico: 'Latin America',
            brazil: 'Latin America',
            argentina: 'Latin America',
            chile: 'Latin America',
            peru: 'Latin America',
            colombia: 'Latin America',
            'united kingdom': 'Europe',
            uk: 'Europe',
            ireland: 'Europe',
            france: 'Europe',
            germany: 'Europe',
            spain: 'Europe',
            italy: 'Europe',
            russia: 'Europe',
            india: 'India',
            uae: 'Middle East - Africa',
            'united arab emirates': 'Middle East - Africa',
            iran: 'Middle East - Africa',
            israel: 'Middle East - Africa',
            saudiarabia: 'Middle East - Africa',
            'saudi arabia': 'Middle East - Africa',
            qatar: 'Middle East - Africa',
            oman: 'Middle East - Africa',
            egypt: 'Middle East - Africa',
            nigeria: 'Middle East - Africa',
            kenya: 'Middle East - Africa',
            'south africa': 'Middle East - Africa',
            singapore: 'South East Asia',
            thailand: 'South East Asia',
            vietnam: 'South East Asia',
            malaysia: 'South East Asia',
            indonesia: 'South East Asia',
            philippines: 'South East Asia',
            china: 'FarEast',
            japan: 'FarEast',
            'south korea': 'FarEast',
            korea: 'FarEast',
            taiwan: 'FarEast',
            australia: 'Australia-NewZealand',
            'new zealand': 'Australia-NewZealand'
        };

        if (countryToZone[normalized]) {
            return countryToZone[normalized];
        }

        // Some source files use zone-like values in `country`.
        if (normalized === 'india') return 'India';
        if (normalized === 'middle east - africa') return 'Middle East - Africa';
        if (normalized === 'middle east africa') return 'Middle East - Africa';
        if (normalized === 'europe') return 'Europe';
        if (normalized === 'south east asia') return 'South East Asia';
        if (normalized === 'southeast asia') return 'South East Asia';
        if (normalized === 'us') return 'US';
        if (normalized === 'latin america') return 'Latin America';
        if (normalized === 'australia-newzealand') return 'Australia-NewZealand';
        if (normalized === 'australia newzealand') return 'Australia-NewZealand';
        if (normalized === 'fareast') return 'FarEast';
        if (normalized === 'far east') return 'FarEast';

        return null;
    }

    private getZoneFromCoordinates(latitude: number, longitude: number): ZoneName | null {
        const lat = Number(latitude);
        const lng = Number(longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return null;
        }

        // US + most of Canada by coordinate fallback.
        if (lat >= 15 && lat <= 72 && lng >= -170 && lng <= -60) {
            return 'US';
        }

        // Latin America remains supported in filtering but hidden in dropdown.
        if (lat >= -56 && lat <= 33 && lng >= -118 && lng <= -34) {
            return 'Latin America';
        }

        if (lat >= 6 && lat <= 38 && lng >= 68 && lng <= 97) {
            return 'India';
        }

        if (lat >= 35 && lat <= 72 && lng >= -25 && lng <= 45) {
            return 'Europe';
        }

        if (lat >= -35 && lat <= 40 && lng >= -20 && lng <= 60) {
            return 'Middle East - Africa';
        }

        if (lat >= -11 && lat <= 24 && lng >= 92 && lng <= 141) {
            return 'South East Asia';
        }

        if (lat >= 20 && lat <= 55 && lng >= 120 && lng <= 150) {
            return 'FarEast';
        }

        if (lat >= -50 && lat <= -10 && ((lng >= 110 && lng <= 180) || (lng >= -180 && lng <= -170))) {
            return 'Australia-NewZealand';
        }

        return null;
    }

    private applyThemeMode(mode: ThemeMode): void {
        if (mode === 'heatmap') {
            this.applyHeatmapMode();
            return;
        }

        this.applyPointThemeMode(mode);
    }

    private applyPointThemeMode(mode: PointThemeMode): void {
        if (!this.mapInstance) return;

        this.countryLabelMarkerMap.forEach(m => m.setMap(null));

        this.ngZone.run(() => {
            this.heatmapLoading = false;
            this.zoom = this.defaultThemeZoom;
            this.center = { ...this.defaultCenter };
        });

        this.mapDataLayer?.setMap(null);
        this.countryLabelMarkerMap.forEach(m => m.setMap(null));
        if (this.labelIdleListener) {
            this.labelIdleListener.remove();
            this.labelIdleListener = undefined;
        }

        this.mapOptions = { ...this.mapOptions, styles: this.getPointThemeStyles(mode) };

        const pinIcon = this.getPointThemeIcon(mode);
        if (this.mapInstance) {
            this.googleMarkers.forEach(m => {
                m.setIcon(pinIcon);
                m.setClickable(true);
                m.setMap(this.mapInstance!);
            });
        }
    }

    private getPointThemeStyles(mode: PointThemeMode): google.maps.MapTypeStyle[] {
        switch (mode) {
            case 'tor-control-room':
                return this.torControlRoomMapStyles;
            case 'signal-grid-teal':
                return this.signalGridTealMapStyles;
            case 'light-atlas':
                return this.lightAtlasMapStyles;
            case 'intensity-map':
                return this.intensityMapMapStyles;
            case 'photograph-density':
                return this.photographDensityMapStyles;
            case 'current':
            default:
                // return this.currentMapStyles;
                return this.photographDensityMapStyles;
        }
    }

    private getActivePointTheme(mode: ThemeMode): PointThemeMode {
        return mode === 'heatmap' ? 'current' : mode;
    }

    private getPointThemeIcon(mode: PointThemeMode): google.maps.Icon {
        switch (mode) {
            case 'tor-control-room':
                // return this.buildTorControlRoomIcon();
                return this.buildHollowOrangeCircleIcon();
            case 'signal-grid-teal':
                return this.buildSignalGridIcon();
            case 'light-atlas':
                return this.buildLightAtlasIcon();
            case 'intensity-map':
                return this.buildIntensityMapIcon();
            case 'photograph-density':
                return this.buildPhotographDensityIcon();
            case 'current':
            default:
                return this.buildGlowIcon();
        }
    }

    private isCoordinateValid(location: LocationData): boolean {
        const lat = Number(location.Latitude);
        const lng = Number(location.Longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return false;
        }

        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return false;
        }

        return !(lat === 0 && lng === 0);
    }

    private async removeSeaLocations(locations: LocationData[]): Promise<LocationData[]> {
        try {

            const geoJson = await firstValueFrom(
                this.http.get<{
                    features?: Array<{
                        geometry: any;
                        properties: {
                            name: string;
                        };
                    }>;
                }>(this.countriesGeoJsonUrl)
            );

            const features = (geoJson?.features ?? []).filter(f => !!f.geometry);

            if (!features.length) {
                return locations;
            }

            const landLocations: LocationData[] = [];

            for (const location of locations) {

                for (const feature of features) {

                    if (
                        this.pointInFeature(
                            location.Latitude,
                            location.Longitude,
                            feature.geometry
                        )
                    ) {
                        // ⭐ Save the country name
                        location.ResolvedCountry = feature.properties.name;

                        landLocations.push(location);
                        break;
                    }
                }
            }

            return landLocations;

        } catch {
            return locations;
        }
    }

    private buildGlowIcon(): google.maps.Icon {
        if (this.cachedIcon) {
            return this.cachedIcon;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 56" width="40" height="56">
  <defs>
    <!-- Glow filter -->
    <filter id="pinGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.2" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  
  <!-- Transparent map pin shape with cyan border -->
  <path d="M 20 4 
           C 27.7 4 34 10.3 34 18 
           C 34 28 20 50 20 50 
           C 20 50 6 28 6 18 
           C 6 10.3 12.3 4 20 4 Z" 
        fill="none" 
        stroke="#59E7FF" 
        stroke-width="2"
        stroke-linecap="round" 
        stroke-linejoin="round"
        opacity="1"
        filter="url(#pinGlow)"/>
  
  <!-- Inner circle -->
  <circle cx="20" cy="16" r="5" 
          fill="none" 
          stroke="#59E7FF"
          stroke-width="1.5"
          filter="url(#pinGlow)"/>
</svg>`;

        this.cachedIcon = {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new google.maps.Size(28, 28),
            anchor: new google.maps.Point(10, 26),
            labelOrigin: new google.maps.Point(10, 10)
        };

        return this.cachedIcon;
    }

    private buildTorControlRoomIcon(): google.maps.Icon {
        if (this.cachedTorControlRoomIcon) {
            return this.cachedTorControlRoomIcon;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 56" width="40" height="56">
    <defs>
        <filter id="torControlRoomPinGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="coloredBlur"/>
            <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
            </feMerge>
        </filter>
    </defs>

    <path d="M 20 4
                     C 27.7 4 34 10.3 34 18
                     C 34 28 20 50 20 50
                     C 20 50 6 28 6 18
                     C 6 10.3 12.3 4 20 4 Z"
                fill="none"
                stroke="#F15A24"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                opacity="1"
                filter="url(#torControlRoomPinGlow)"/>

    <circle cx="20" cy="16" r="5"
                    fill="none"
                    stroke="#EF4423"
                    stroke-width="1.5"
                    filter="url(#torControlRoomPinGlow)"/>
</svg>`;

        this.cachedTorControlRoomIcon = {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new google.maps.Size(28, 28),
            anchor: new google.maps.Point(10, 26),
            labelOrigin: new google.maps.Point(10, 10)
        };

        return this.cachedTorControlRoomIcon;
    }

    private buildHollowOrangeCircleIcon(): google.maps.Icon {
        if (this.cachedHollowOrangeCircleIcon) {
            return this.cachedHollowOrangeCircleIcon;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20">
  <circle cx="10" cy="10" r="4" fill="none" stroke="#F15A24" stroke-width="1.8"/>
  <circle cx="10" cy="10" r="2.2" fill="none" stroke="#EF4423" stroke-width="1.2"/>
</svg>`;

        this.cachedHollowOrangeCircleIcon = {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new google.maps.Size(12, 12),
            anchor: new google.maps.Point(6, 6),
            labelOrigin: new google.maps.Point(6, 6)
        };

        return this.cachedHollowOrangeCircleIcon;
    }

    private buildSignalGridIcon(): google.maps.Icon {
        if (this.cachedSignalGridIcon) {
            return this.cachedSignalGridIcon;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36">
  <defs>
    <filter id="atlasShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.25"/>
    </filter>
  </defs>
  <!-- Pulsing outer ring -->
  <circle cx="18" cy="18" r="12" fill="none" stroke="#0ea5e9" stroke-width="1.5" opacity="0.3" filter="url(#atlasShadow)"/>
  <!-- Pulsing middle ring -->
  <circle cx="18" cy="18" r="8" fill="none" stroke="#0ea5e9" stroke-width="1.5" opacity="0.5" filter="url(#atlasShadow)"/>
  <!-- Static inner circle -->
  <circle cx="18" cy="18" r="5" fill="#0ea5e9" stroke="#0369a1" stroke-width="1.5" filter="url(#atlasShadow)"/>
  <!-- Center dot -->
  <circle cx="18" cy="18" r="2" fill="#ffffff" opacity="0.9"/>
</svg>`;
        this.cachedSignalGridIcon = {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new google.maps.Size(24, 24),
            anchor: new google.maps.Point(12, 12),
            labelOrigin: new google.maps.Point(12, 12)
        };

        return this.cachedSignalGridIcon;
    }

    private buildLightAtlasIcon(): google.maps.Icon {
        if (this.cachedLightAtlasIcon) {
            return this.cachedLightAtlasIcon;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36">
  <defs>
    <filter id="atlasShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-opacity="0.25"/>
    </filter>
  </defs>
  <!-- Pulsing outer ring -->
  <circle cx="18" cy="18" r="12" fill="none" stroke="#0ea5e9" stroke-width="1.5" opacity="0.3" filter="url(#atlasShadow)"/>
  <!-- Pulsing middle ring -->
  <circle cx="18" cy="18" r="8" fill="none" stroke="#0ea5e9" stroke-width="1.5" opacity="0.5" filter="url(#atlasShadow)"/>
  <!-- Static inner circle -->
  <circle cx="18" cy="18" r="5" fill="#0ea5e9" stroke="#0369a1" stroke-width="1.5" filter="url(#atlasShadow)"/>
  <!-- Center dot -->
  <circle cx="18" cy="18" r="2" fill="#ffffff" opacity="0.9"/>
</svg>`;

        this.cachedLightAtlasIcon = {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new google.maps.Size(28, 28),
            anchor: new google.maps.Point(14, 14),
            labelOrigin: new google.maps.Point(14, 14)
        };

        return this.cachedLightAtlasIcon;
    }

    private buildIntensityMapIcon(): google.maps.Icon {
        if (this.cachedHeatmapIcon) {
            return this.cachedHeatmapIcon;
        }

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36">
  <defs>
    <radialGradient id="intensityGradient" cx="50%" cy="50%" r="50%">
      <stop offset="0%" style="stop-color:#fbbf24;stop-opacity:1" />
      <stop offset="33%" style="stop-color:#f97316;stop-opacity:1" />
      <stop offset="66%" style="stop-color:#d946a6;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#6b1b47;stop-opacity:1" />
    </radialGradient>
    <filter id="intensityShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity="0.35"/>
    </filter>
  </defs>
  <!-- Intensity gradient circle -->
  <circle cx="18" cy="18" r="10" fill="url(#intensityGradient)" filter="url(#intensityShadow)"/>
  <!-- Outer ring accent -->
  <circle cx="18" cy="18" r="10" fill="none" stroke="#fbbf24" stroke-width="1.5" opacity="0.6"/>
</svg>`;

        this.cachedHeatmapIcon = {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new google.maps.Size(28, 28),
            anchor: new google.maps.Point(14, 14),
            labelOrigin: new google.maps.Point(14, 14)
        };

        return this.cachedHeatmapIcon;
    }

    private buildPhotographDensityIcon(): google.maps.Icon {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36" width="36" height="36">
  <defs>
    <radialGradient id="densityGradient" cx="50%" cy="50%" r="50%">
            <stop offset="0%" style="stop-color:#F15A24;stop-opacity:1" />
            <stop offset="50%" style="stop-color:#EF4423;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#EF4423;stop-opacity:1" />
    </radialGradient>
    <filter id="densityShadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity="0.4"/>
    </filter>
  </defs>
    <!-- Density gradient circle (orange profile) -->
  <circle cx="8" cy="8" r="5" fill="url(#densityGradient)" filter="url(#densityShadow)"/>
</svg>`;

        return {
            url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
            scaledSize: new google.maps.Size(28, 28),
            anchor: new google.maps.Point(14, 14),
            labelOrigin: new google.maps.Point(14, 14)
        };
    }

    private resolveLocationName(location: LocationData, fallbackIndex: number): string {
        return location.name || location.Name || location.title || `Location ${fallbackIndex}`;
    }

    // private resolveLocationCountry(location: LocationData): string {
    //     return location.country || location.Country || 'Unknown Region';
    // }
    private resolveLocationCountry(location: LocationData): string {

        return (
            location.ResolvedCountry ||
            location.country ||
            location.Country ||
            // location.COUNTRY ||
            // location.countryName ||
            // location.CountryName ||
            'Unknown Region'
        );
    }

    private applyCurrentMode(): void {
        this.applyPointThemeMode('current');
    }

    private applyHeatmapMode(): void {
        if (!this.mapInstance) return;

        this.ngZone.run(() => {
            this.heatmapLoading = true;
            this.selectedMarker = undefined;
            this.zoom = this.defaultThemeZoom;
            this.center = { lat: 20, lng: 20 };
        });
        this.googleMarkers.forEach(m => { m.setMap(null); m.setClickable(false); });
        this.mapOptions = { ...this.mapOptions, styles: this.heatmapMapStyles };

        if (!this.mapDataLayer) {
            this.mapDataLayer = new google.maps.Data({ map: this.mapInstance });
        } else {
            this.mapDataLayer.setMap(this.mapInstance);
        }

        if (this.heatmapGeoJsonLoaded) {
            this.recomputeHeatmapCountsFromLoadedGeoJson();
            this.ngZone.run(() => { this.heatmapLoading = false; });
            this.renderChoropleth();
            this.renderCountryLabelsFromLocationData();
            return;
        }

        this.mapDataLayer.loadGeoJson(
            'https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/countries.geojson',
            {},
            (features: google.maps.Data.Feature[]) => {
                this.populateCountries(features, this.locationData);
                this.countryPointCounts = this.buildCountryPointCountsFromFeatures(features);
                this.heatmapGeoJsonLoaded = true;
                this.ngZone.run(() => { this.heatmapLoading = false; });
                this.renderChoropleth();
                this.renderCountryLabelsFromLocationData();
            }
        );
    }

    private recomputeHeatmapCountsFromLoadedGeoJson(): void {
        if (!this.mapDataLayer) {
            return;
        }

        const features: google.maps.Data.Feature[] = [];
        this.mapDataLayer.forEach(feature => features.push(feature));
        this.populateCountries(features, this.locationData);
        this.countryPointCounts = this.buildCountryPointCountsFromFeatures(features);
    }

    private renderChoropleth(): void {
        if (!this.mapDataLayer) return;

        const counts = Object.values(this.countryPointCounts).filter(v => v > 0);
        const totalCount = counts.length ? counts.reduce((sum, value) => sum + value, 0) : 1;

        this.mapDataLayer.setStyle(feature => {
            const name = feature.getProperty('name') as string;
            const count = this.countryPointCounts[name] || 0;
            return {
                fillColor: this.getChoroplethColor(count, totalCount),
                fillOpacity: count > 0 ? 0.9 : 0.2,
                strokeColor: count > 0 ? '#f8fafc' : '#e5e7eb',
                strokeWeight: count > 0 ? 0.9 : 0.7,
                clickable: false
            };
        });
    }

    //     private renderCountryLabelsFromLocationData(): void {
    //     if (!this.mapInstance) return;

    //     console.log('countryPointCounts', this.countryPointCounts);

    //     this.countryLabelMarkers.forEach(m => m.setMap(null));
    //     this.countryLabelMarkers = [];

    //     const countryCentroids: Record<string, { lat: number; lng: number; count: number }> = {};

    //     for (const location of this.locationData) {
    //         const country = this.resolveLocationCountry(location);
    //         if (!country || country === 'Unknown Region') continue;

    //         if (!countryCentroids[country]) {
    //             countryCentroids[country] = { lat: 0, lng: 0, count: 0 };
    //         }

    //         countryCentroids[country].lat += location.Latitude;
    //         countryCentroids[country].lng += location.Longitude;
    //         countryCentroids[country].count++;
    //     }

    //     for (const [country, data] of Object.entries(countryCentroids)) {

    //         console.log(
    //             'Country:',
    //             country,
    //             'Count:',
    //             this.countryPointCounts[country]
    //         );

    //         if (!this.countryPointCounts[country] || this.countryPointCounts[country] <= 0) {
    //             continue;
    //         }

    //         console.log('Creating label for', country);

    //         const marker = new google.maps.Marker({
    //             position: {
    //                 lat: data.lat / data.count,
    //                 lng: data.lng / data.count
    //             },
    //             map: this.mapInstance,
    //             label: {
    //                 text: country,
    //                 color: '#000000',
    //                 fontSize: '14px',
    //                 fontWeight: 'bold'
    //             },
    //             icon: {
    //                 path: google.maps.SymbolPath.CIRCLE,
    //                 scale: 0
    //             }
    //         });

    //         this.countryLabelMarkers.push(marker);
    //     }

    //     console.log('Country labels created:', this.countryLabelMarkers.length);
    // }

    private layoutCountryLabels(): void {
        if (!this.mapInstance || this.themeMode !== 'heatmap') return;

        this.withProjection(projection => {
            const sorted = [...this.countryLabelInfos].sort((a, b) => b.count - a.count);
            const counts = sorted.map(i => i.count).sort((a, b) => a - b);
            const tierThreshold = counts.length
                ? counts[Math.min(Math.floor(counts.length * 0.7), counts.length - 1)]
                : Infinity;

            const PADDING = 6;
            const placedBoxes: { x: number; y: number; w: number; h: number }[] = [];

            for (const info of sorted) {
                const marker = this.countryLabelMarkerMap.get(info.country);
                if (!marker) continue;

                const point = projection.fromLatLngToContainerPixel(
                    new google.maps.LatLng(info.position.lat, info.position.lng)
                );
                if (!point) {
                    marker.setMap(null);
                    continue;
                }

                const isPrimary = info.count >= tierThreshold;
                const width = this.measureLabelWidth(info.country, isPrimary) + 12;
                const height = isPrimary ? 14 : 12;

                const box = { x: point.x - width / 2, y: point.y - height / 2, w: width, h: height };

                const overlaps = placedBoxes.some(p =>
                    box.x < p.x + p.w + PADDING &&
                    box.x + box.w + PADDING > p.x &&
                    box.y < p.y + p.h + PADDING &&
                    box.y + box.h + PADDING > p.y
                );

                if (overlaps) {
                    marker.setMap(null);
                    continue;
                }

                placedBoxes.push(box);
                marker.setLabel({
                    text: info.country,
                    fontSize: '10px',
                    fontWeight: '600',
                    className: isPrimary ? 'country-label-style country-label-style--primary' : 'country-label-style'
                });
                marker.setMap(this.mapInstance!);
            }
        });
    }

    // private renderCountryLabelsFromLocationData(): void {
    //     if (!this.mapInstance) return;

    //     this.countryLabelMarkers.forEach(m => m.setMap(null));
    //     this.countryLabelMarkers = [];

    //     for (const [country, centroid] of Object.entries(this.countryCentroids)) {
    //         const marker = new google.maps.Marker({
    //             position: { lat: centroid.lat, lng: centroid.lng },
    //             map: this.mapInstance,
    //             label: {
    //                 text: country,
    //                 color: '#000000',
    //                 fontSize: '14px',
    //                 fontWeight: 'bold'
    //             },
    //             icon: {
    //                 path: google.maps.SymbolPath.CIRCLE,
    //                 scale: 0
    //             },
    //             clickable: false
    //         });

    //         this.countryLabelMarkers.push(marker);
    //     }
    // }

    private renderCountryLabelsFromLocationData(): void {
        if (!this.mapInstance) return;

        this.ensureLabelProjectionOverlay();

        this.countryLabelMarkerMap.forEach(m => m.setMap(null));
        this.countryLabelMarkerMap.clear();
        this.countryLabelInfos = [];

        for (const [country, centroid] of Object.entries(this.countryCentroids)) {
            const info: CountryLabelInfo = {
                country,
                position: { lat: centroid.lat, lng: centroid.lng },
                count: centroid.count
            };
            this.countryLabelInfos.push(info);

            const marker = new google.maps.Marker({
                position: info.position,
                map: null,
                clickable: false,
                icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 }
            });

            this.countryLabelMarkerMap.set(country, marker);
        }

        this.layoutCountryLabels();

        if (!this.labelIdleListener) {
            this.labelIdleListener = this.mapInstance.addListener('idle', () => {
                this.ngZone.run(() => this.layoutCountryLabels());
            });
        }
    }

    getCountryLabelPosition(
        country: string
    ): google.maps.LatLngLiteral | null {

        const points: google.maps.LatLngLiteral[] = [];

        for (const marker of this.googleMarkers) {
            const cityMarker = this.markerMap.get(marker);

            if (cityMarker?.country === country) {
                const pos = marker.getPosition();
                if (pos) {
                    points.push({
                        lat: pos.lat(),
                        lng: pos.lng()
                    });
                }
            }
        }

        if (!points.length) {
            return null;
        }

        const lat =
            points.reduce((sum, p) => sum + p.lat, 0) / points.length;

        const lng =
            points.reduce((sum, p) => sum + p.lng, 0) / points.length;

        return { lat, lng };
    }

    // private buildCountryPointCountsFromFeatures(features: google.maps.Data.Feature[]): Record<string, number> {
    //     const counts: Record<string, number> = {};
    //     const points = this.googleMarkers
    //         .map(m => { const p = m.getPosition(); return p ? { lat: p.lat(), lng: p.lng() } : null; })
    //         .filter(Boolean) as Array<{ lat: number; lng: number }>;

    //     for (const feature of features) {
    //         const name = feature.getProperty('name') as string;
    //         if (!name) continue;
    //         let count = 0;
    //         feature.getGeometry()?.forEachLatLng(() => { }); // ensure geometry is accessible
    //         const geom = feature.getGeometry();
    //         if (!geom) continue;
    //         for (const pt of points) {
    //             if (this.pointInGoogleGeometry(pt.lat, pt.lng, geom)) count++;
    //         }
    //         if (count > 0) counts[name] = count;
    //     }
    //     return counts;
    // }
    private buildCountryPointCountsFromFeatures(features: google.maps.Data.Feature[]): Record<string, number> {
        const counts: Record<string, number> = {};
        this.countryCentroids = {};

        const points = this.googleMarkers
            .map(m => { const p = m.getPosition(); return p ? { lat: p.lat(), lng: p.lng() } : null; })
            .filter(Boolean) as Array<{ lat: number; lng: number }>;

        for (const feature of features) {
            const name = feature.getProperty('name') as string;
            if (!name) continue;

            const geom = feature.getGeometry();
            if (!geom) continue;

            let count = 0;
            let sumLat = 0;
            let sumLng = 0;

            for (const pt of points) {
                if (this.pointInGoogleGeometry(pt.lat, pt.lng, geom)) {
                    count++;
                    sumLat += pt.lat;
                    sumLng += pt.lng;
                }
            }

            if (count > 0) {
                const centroid = this.getGeometryLabelPosition(geom);
                counts[name] = count;
                this.countryCentroids[name] = {
                    lat: centroid?.lat ?? sumLat / count,
                    lng: centroid?.lng ?? sumLng / count,
                    count
                };
            }
        }

        return counts;
    }

    private getGeometryLabelPosition(geom: google.maps.Data.Geometry): google.maps.LatLngLiteral | null {
        if (geom.getType() === 'Polygon') {
            return this.getPolygonLabelPosition(geom as google.maps.Data.Polygon);
        }

        if (geom.getType() === 'MultiPolygon') {
            const polygons = (geom as google.maps.Data.MultiPolygon).getArray();
            let selected: google.maps.Data.Polygon | undefined;
            let largestArea = 0;

            for (const polygon of polygons) {
                const area = this.getPolygonOuterRingArea(polygon);
                if (area > largestArea) {
                    largestArea = area;
                    selected = polygon;
                }
            }

            return selected ? this.getPolygonLabelPosition(selected) : null;
        }

        return null;
    }

    private getPolygonLabelPosition(polygon: google.maps.Data.Polygon): google.maps.LatLngLiteral | null {
        const rings = polygon.getArray();
        if (!rings.length) {
            return null;
        }

        const vertices = rings[0].getArray();
        if (!vertices.length) {
            return null;
        }

        return this.getRingCentroid(vertices);
    }

    private getPolygonOuterRingArea(polygon: google.maps.Data.Polygon): number {
        const rings = polygon.getArray();
        if (!rings.length) {
            return 0;
        }

        return Math.abs(this.getSignedRingArea(rings[0].getArray()));
    }

    private getRingCentroid(vertices: google.maps.LatLng[]): google.maps.LatLngLiteral {
        if (vertices.length === 1) {
            return vertices[0].toJSON();
        }

        const signedArea = this.getSignedRingArea(vertices);
        if (Math.abs(signedArea) < Number.EPSILON) {
            const lat = vertices.reduce((sum, vertex) => sum + vertex.lat(), 0) / vertices.length;
            const lng = vertices.reduce((sum, vertex) => sum + vertex.lng(), 0) / vertices.length;
            return { lat, lng };
        }

        let centroidLat = 0;
        let centroidLng = 0;

        for (let i = 0; i < vertices.length; i++) {
            const current = vertices[i];
            const next = vertices[(i + 1) % vertices.length];
            const cross = current.lng() * next.lat() - next.lng() * current.lat();

            centroidLng += (current.lng() + next.lng()) * cross;
            centroidLat += (current.lat() + next.lat()) * cross;
        }

        const areaFactor = 6 * signedArea;
        return {
            lat: centroidLat / areaFactor,
            lng: centroidLng / areaFactor
        };
    }

    private getSignedRingArea(vertices: google.maps.LatLng[]): number {
        let area = 0;

        for (let i = 0; i < vertices.length; i++) {
            const current = vertices[i];
            const next = vertices[(i + 1) % vertices.length];
            area += current.lng() * next.lat() - next.lng() * current.lat();
        }

        return area / 2;
    }

    private pointInGoogleGeometry(lat: number, lng: number, geom: google.maps.Data.Geometry): boolean {
        const type = geom.getType();
        if (type === 'Polygon') {
            const poly = geom as google.maps.Data.Polygon;
            const rings = poly.getArray();
            if (!rings.length) return false;
            return this.pointInLatLngArray(lat, lng, rings[0].getArray());
        }
        if (type === 'MultiPolygon') {
            const mp = geom as google.maps.Data.MultiPolygon;
            return mp.getArray().some(poly => {
                const rings = poly.getArray();
                return rings.length > 0 && this.pointInLatLngArray(lat, lng, rings[0].getArray());
            });
        }
        return false;
    }

    private pointInLatLngArray(lat: number, lng: number, vertices: google.maps.LatLng[]): boolean {
        let inside = false;
        const x = lng, y = lat;
        for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
            const xi = vertices[i].lng(), yi = vertices[i].lat();
            const xj = vertices[j].lng(), yj = vertices[j].lat();
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    private buildCountryPointCounts(features: any[]): Record<string, number> {
        const counts: Record<string, number> = {};
        const points = this.googleMarkers
            .map(m => { const p = m.getPosition(); return p ? { lat: p.lat(), lng: p.lng() } : null; })
            .filter(Boolean) as Array<{ lat: number; lng: number }>;

        for (const feature of features) {
            const name = feature.properties?.name;
            if (!name) continue;
            let count = 0;
            for (const pt of points) {
                if (this.pointInFeature(pt.lat, pt.lng, feature.geometry)) count++;
            }
            if (count > 0) counts[name] = count;
        }
        return counts;
    }

    private pointInFeature(lat: number, lng: number, geom: any): boolean {
        if (!geom) {
            return false;
        }

        if (geom.type === 'Polygon') {
            return this.pointInRing(lat, lng, geom.coordinates[0]);
        }
        if (geom.type === 'MultiPolygon') {
            return geom.coordinates.some((poly: number[][][]) => this.pointInRing(lat, lng, poly[0]));
        }
        return false;
    }
    private populateCountries(
        features: google.maps.Data.Feature[],
        locations: LocationData[]
    ): void {

        console.log("populateCountries()");
        console.log("Features:", features.length);
        console.log("Locations:", locations.length);

        for (const location of locations) {

            let matched = false;

            for (const feature of features) {

                const geometry = feature.getGeometry();
                if (!geometry) {
                    continue;
                }

                if (
                    this.pointInGoogleGeometry(
                        location.Latitude,
                        location.Longitude,
                        geometry
                    )
                ) {
                    const country = feature.getProperty('name') as string;

                    console.log(
                        "MATCH:",
                        location.Latitude,
                        location.Longitude,
                        "=>",
                        country
                    );

                    location.ResolvedCountry = country;
                    matched = true;
                    break;
                }
            }

            if (!matched) {
                console.log(
                    "NO MATCH:",
                    location.Latitude,
                    location.Longitude
                );
            }
        }
    }

    private pointInRing(lat: number, lng: number, ring: number[][]): boolean {
        let inside = false;
        const x = lng, y = lat;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][0], yi = ring[i][1];
            const xj = ring[j][0], yj = ring[j][1];
            if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    private getChoroplethColor(count: number, totalCount: number): string {
        if (count === 0) return '#f1f2f4';

        const ratio = count / totalCount;

        if (ratio < 0.2) return '#ecbbd3'; // Light Pink
        if (ratio < 0.45) return '#d67ba5'; // Pink
        if (ratio < 0.75) return '#c91c6d'; // Magenta
        return '#6b032b';                   // Deep Magenta
    }

    private updateViewport(): void {
        if (!this.mapInstance || this.googleMarkers.length === 0) {
            return;
        }

        if (this.googleMarkers.length === 1) {
            const pos = this.googleMarkers[0].getPosition();
            if (pos) {
                this.center = pos.toJSON();
            }
            this.zoom = 10;
            return;
        }

        const bounds = new google.maps.LatLngBounds();

        for (const marker of this.googleMarkers) {
            const pos = marker.getPosition();
            if (pos) {
                bounds.extend(pos);
            }
        }

        this.mapInstance.fitBounds(bounds);
        this.center = bounds.getCenter().toJSON();
    }

    private loadGoogleMapsApi(): Promise<void> {
        if (typeof google !== 'undefined' && typeof google.maps !== 'undefined') {
            return Promise.resolve();
        }

        return new Promise((resolve, reject) => {
            const existingScript = document.getElementById('google-maps-script') as HTMLScriptElement | null;

            const handleLoad = () => {
                if (existingScript) {
                    existingScript.dataset['loaded'] = 'true';
                }
                resolve();
            };

            const handleError = () => reject(new Error('Google Maps API failed to load.'));

            if (existingScript) {
                existingScript.addEventListener('load', handleLoad, { once: true });
                existingScript.addEventListener('error', handleError, { once: true });
                return;
            }

            const script = document.createElement('script');
            script.id = 'google-maps-script';
            script.src = `https://maps.googleapis.com/maps/api/js?key=${environment.googleMapsApiKey}`;
            script.async = true;
            script.defer = true;
            script.addEventListener('load', () => {
                script.dataset['loaded'] = 'true';
                resolve();
            }, { once: true });
            script.addEventListener('error', handleError, { once: true });
            document.head.appendChild(script);
        });
    }

}
interface CountryLabelInfo {
    country: string;
    position: google.maps.LatLngLiteral;
    count: number;
}