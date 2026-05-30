/* Bookmark entity/domain model converter */

package com.freerdp.freerdpcore.data;

import com.freerdp.freerdpcore.domain.BookmarkBase;

public final class BookmarkConverter
{
	private BookmarkConverter()
	{
	}

	public static BookmarkBase toBookmark(BookmarkEntity e)
	{
		BookmarkBase bm = new BookmarkBase();

		bm.setId(e.id);
		bm.setLabel(e.label);
		bm.setUsername(e.username);
		bm.setPassword(e.password);
		bm.setDomain(e.domain);
		bm.setHostname(e.hostname);
		bm.setPort(e.port);

		BookmarkBase.ScreenSettings screen = bm.getScreenSettings();
		screen.setColors(e.colors);
		screen.setResolution(e.resolution);
		screen.setWidth(e.width);
		screen.setHeight(e.height);

		BookmarkBase.PerformanceFlags perf = bm.getPerformanceFlags();
		perf.setRemoteFX(e.perfRemoteFx);
		perf.setGfx(e.perfGfx);
		perf.setH264(e.perfGfxH264);
		perf.setWallpaper(e.perfWallpaper);
		perf.setTheming(e.perfTheming);
		perf.setFullWindowDrag(e.perfFullWindowDrag);
		perf.setMenuAnimations(e.perfMenuAnimations);
		perf.setFontSmoothing(e.perfFontSmoothing);
		perf.setDesktopComposition(e.perfDesktopComposition);

		BookmarkBase.AdvancedSettings adv = bm.getAdvancedSettings();
		adv.setEnable3GSettings(e.enable3gSettings);
		adv.setRedirectSDCard(e.redirectSdcard);
		adv.setRedirectSound(e.redirectSound);
		adv.setRedirectMicrophone(e.redirectMicrophone);
		adv.setSecurity(e.security);
		adv.setRemoteProgram(e.remoteProgram);
		adv.setWorkDir(e.workDir);
		adv.setConsoleMode(e.consoleMode);

		BookmarkBase.ScreenSettings screen3g = adv.getScreen3G();
		screen3g.setColors(e.screen3gColors);
		screen3g.setResolution(e.screen3gResolution);
		screen3g.setWidth(e.screen3gWidth);
		screen3g.setHeight(e.screen3gHeight);

		BookmarkBase.PerformanceFlags perf3g = adv.getPerformance3G();
		perf3g.setRemoteFX(e.perf3gRemoteFx);
		perf3g.setGfx(e.perf3gGfx);
		perf3g.setH264(e.perf3gGfxH264);
		perf3g.setWallpaper(e.perf3gWallpaper);
		perf3g.setTheming(e.perf3gTheming);
		perf3g.setFullWindowDrag(e.perf3gFullWindowDrag);
		perf3g.setMenuAnimations(e.perf3gMenuAnimations);
		perf3g.setFontSmoothing(e.perf3gFontSmoothing);
		perf3g.setDesktopComposition(e.perf3gDesktopComposition);

		bm.setEnableGatewaySettings(e.enableGatewaySettings);
		BookmarkBase.GatewaySettings gw = bm.getGatewaySettings();
		gw.setHostname(e.gatewayHostname);
		gw.setPort(e.gatewayPort);
		gw.setUsername(e.gatewayUsername);
		gw.setPassword(e.gatewayPassword);
		gw.setDomain(e.gatewayDomain);

		BookmarkBase.DebugSettings dbg = bm.getDebugSettings();
		dbg.setDebugLevel(e.debugLevel);
		dbg.setAsyncChannel(e.asyncChannel);
		dbg.setAsyncUpdate(e.asyncUpdate);

		return bm;
	}

	public static BookmarkEntity toEntity(BookmarkBase bm)
	{
		BookmarkEntity e = new BookmarkEntity();
		if (bm.getId() > 0)
		{
			e.id = bm.getId();
		}
		e.label = bm.getLabel();
		e.username = bm.getUsername();
		e.password = bm.getPassword();
		e.domain = bm.getDomain();
		e.hostname = bm.getHostname();
		e.port = bm.getPort();

		BookmarkBase.ScreenSettings screen = bm.getScreenSettings();
		e.colors = screen.getColors();
		e.resolution = screen.getResolution();
		e.width = screen.getWidth();
		e.height = screen.getHeight();

		BookmarkBase.PerformanceFlags perf = bm.getPerformanceFlags();
		e.perfRemoteFx = perf.getRemoteFX();
		e.perfGfx = perf.getGfx();
		e.perfGfxH264 = perf.getH264();
		e.perfWallpaper = perf.getWallpaper();
		e.perfTheming = perf.getTheming();
		e.perfFullWindowDrag = perf.getFullWindowDrag();
		e.perfMenuAnimations = perf.getMenuAnimations();
		e.perfFontSmoothing = perf.getFontSmoothing();
		e.perfDesktopComposition = perf.getDesktopComposition();

		BookmarkBase.AdvancedSettings adv = bm.getAdvancedSettings();
		e.enable3gSettings = adv.getEnable3GSettings();
		e.redirectSdcard = adv.getRedirectSDCard();
		e.redirectSound = adv.getRedirectSound();
		e.redirectMicrophone = adv.getRedirectMicrophone();
		e.security = adv.getSecurity();
		e.remoteProgram = adv.getRemoteProgram();
		e.workDir = adv.getWorkDir();
		e.consoleMode = adv.getConsoleMode();

		BookmarkBase.ScreenSettings screen3g = adv.getScreen3G();
		e.screen3gColors = screen3g.getColors();
		e.screen3gResolution = screen3g.getResolution();
		e.screen3gWidth = screen3g.getWidth();
		e.screen3gHeight = screen3g.getHeight();

		BookmarkBase.PerformanceFlags perf3g = adv.getPerformance3G();
		e.perf3gRemoteFx = perf3g.getRemoteFX();
		e.perf3gGfx = perf3g.getGfx();
		e.perf3gGfxH264 = perf3g.getH264();
		e.perf3gWallpaper = perf3g.getWallpaper();
		e.perf3gTheming = perf3g.getTheming();
		e.perf3gFullWindowDrag = perf3g.getFullWindowDrag();
		e.perf3gMenuAnimations = perf3g.getMenuAnimations();
		e.perf3gFontSmoothing = perf3g.getFontSmoothing();
		e.perf3gDesktopComposition = perf3g.getDesktopComposition();

		e.enableGatewaySettings = bm.getEnableGatewaySettings();
		BookmarkBase.GatewaySettings gw = bm.getGatewaySettings();
		e.gatewayHostname = gw.getHostname();
		e.gatewayPort = gw.getPort();
		e.gatewayUsername = gw.getUsername();
		e.gatewayPassword = gw.getPassword();
		e.gatewayDomain = gw.getDomain();

		BookmarkBase.DebugSettings dbg = bm.getDebugSettings();
		e.debugLevel = dbg.getDebugLevel();
		e.asyncChannel = dbg.getAsyncChannel();
		e.asyncUpdate = dbg.getAsyncUpdate();

		return e;
	}
}
