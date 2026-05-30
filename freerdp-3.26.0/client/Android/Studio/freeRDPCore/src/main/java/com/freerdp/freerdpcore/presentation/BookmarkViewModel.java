/*
 * ViewModel for BookmarkActivity — handles asynchronous data loading and saving, keeping database
 * and file I/O off the main thread.
 */

package com.freerdp.freerdpcore.presentation;

import android.app.Application;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

import com.freerdp.freerdpcore.data.AppDatabase;
import com.freerdp.freerdpcore.data.HistoryDatabase;
import com.freerdp.freerdpcore.domain.BookmarkBase;
import com.freerdp.freerdpcore.domain.ConnectionReference;
import com.freerdp.freerdpcore.services.ManualBookmarkGateway;
import com.freerdp.freerdpcore.services.QuickConnectHistoryGateway;
import com.freerdp.freerdpcore.utils.RDPFileParser;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class BookmarkViewModel extends AndroidViewModel
{
	private static final String TAG = "BookmarkViewModel";

	// LiveData for observing state changes from the Activity
	private final MutableLiveData<BookmarkBase> bookmarkLiveData = new MutableLiveData<>();
	private final MutableLiveData<Boolean> saveCompleteEvent = new MutableLiveData<>();

	private boolean settingsChanged = false;
	private boolean newBookmark = false;

	// Single-thread executor handles Room DB and File parsing off the UI thread
	private final ExecutorService executor = Executors.newSingleThreadExecutor();

	private final ManualBookmarkGateway manualBookmarkGateway;
	private final QuickConnectHistoryGateway quickConnectHistoryGateway;

	public BookmarkViewModel(@NonNull Application application)
	{
		super(application);
		manualBookmarkGateway =
		    new ManualBookmarkGateway(AppDatabase.getInstance(application).bookmarkDao());
		quickConnectHistoryGateway =
		    new QuickConnectHistoryGateway(HistoryDatabase.getInstance(application).historyDao());
	}

	public LiveData<BookmarkBase> getBookmarkLiveData()
	{
		return bookmarkLiveData;
	}

	public LiveData<Boolean> getSaveCompleteEvent()
	{
		return saveCompleteEvent;
	}

	public BookmarkBase getBookmark()
	{
		return bookmarkLiveData.getValue();
	}

	public boolean isSettingsChanged()
	{
		return settingsChanged;
	}

	public void setSettingsChanged(boolean changed)
	{
		settingsChanged = changed;
	}

	public boolean isNewBookmark()
	{
		return newBookmark;
	}

	public void setNewBookmark(boolean isNew)
	{
		newBookmark = isNew;
	}

	// -------------------------------------------------------------------------
	// Async Operations
	// -------------------------------------------------------------------------

	public void loadBookmark(Bundle bundle, SharedPreferences prefs)
	{
		if (bookmarkLiveData.getValue() != null)
			return;

		executor.execute(() -> {
			BookmarkBase bookmark = null;
			boolean isNew = false;

			if (bundle != null && bundle.containsKey(BookmarkActivity.PARAM_CONNECTION_REFERENCE))
			{
				String refStr = bundle.getString(BookmarkActivity.PARAM_CONNECTION_REFERENCE);

				if (ConnectionReference.isBookmarkReference(refStr))
				{
					bookmark =
					    manualBookmarkGateway.findById(ConnectionReference.getBookmarkId(refStr));
					isNew = false;
				}
				else if (ConnectionReference.isHostnameReference(refStr))
				{
					bookmark = new BookmarkBase();
					bookmark.setLabel(ConnectionReference.getHostname(refStr));
					bookmark.setHostname(ConnectionReference.getHostname(refStr));
					isNew = true;
				}
				else if (ConnectionReference.isFileReference(refStr))
				{
					String file = ConnectionReference.getFile(refStr);
					bookmark = new BookmarkBase();
					bookmark.setLabel(file);
					try
					{
						RDPFileParser rdpFile = new RDPFileParser(file);
						updateBookmarkFromFile(bookmark, rdpFile);
						bookmark.setLabel(new File(file).getName());
						isNew = true;
					}
					catch (IOException e)
					{
						Log.e(TAG, "Failed reading RDP file", e);
					}
				}
			}

			if (bookmark == null)
			{
				bookmark = new BookmarkBase();
			}

			this.newBookmark = isNew;
			this.settingsChanged = false;

			// Clear TEMP SharedPreferences and write fresh data BEFORE posting to UI
			prefs.edit().clear().apply();
			bookmark.writeToSharedPreferences(prefs);

			// Notify Activity that loading is complete on the Main Thread
			bookmarkLiveData.postValue(bookmark);
		});
	}

	public void saveBookmark(SharedPreferences prefs)
	{
		BookmarkBase bookmark = getBookmark();
		if (bookmark == null)
			return;

		executor.execute(() -> {
			bookmark.readFromSharedPreferences(prefs);

			if (bookmark.getType() == BookmarkBase.TYPE_MANUAL)
			{
				quickConnectHistoryGateway.removeHistoryItem(bookmark.getHostname());

				if (bookmark.getId() > 0)
				{
					manualBookmarkGateway.update(bookmark);
				}
				else
				{
					manualBookmarkGateway.insert(bookmark);
				}
			}

			// Notify Activity to close
			saveCompleteEvent.postValue(true);
		});
	}

	private void updateBookmarkFromFile(BookmarkBase bookmark, RDPFileParser rdpFile)
	{
		String s;
		Integer i;

		s = rdpFile.getString("full address");
		if (s != null)
		{
			if (s.lastIndexOf(":") > s.lastIndexOf("]"))
			{
				try
				{
					bookmark.setPort(Integer.parseInt(s.substring(s.lastIndexOf(":") + 1)));
				}
				catch (NumberFormatException e)
				{
					Log.e(TAG, "Malformed address");
				}
				s = s.substring(0, s.lastIndexOf(":"));
			}
			if (s.startsWith("[") && s.endsWith("]"))
				s = s.substring(1, s.length() - 1);
			bookmark.setHostname(s);
		}

		i = rdpFile.getInteger("server port");
		if (i != null)
			bookmark.setPort(i);

		s = rdpFile.getString("username");
		if (s != null)
			bookmark.setUsername(s);

		s = rdpFile.getString("domain");
		if (s != null)
			bookmark.setDomain(s);

		i = rdpFile.getInteger("connect to console");
		if (i != null)
			bookmark.getAdvancedSettings().setConsoleMode(i == 1);
	}

	@Override protected void onCleared()
	{
		super.onCleared();
		executor.shutdown(); // Clean up threads when ViewModel dies
	}
}
