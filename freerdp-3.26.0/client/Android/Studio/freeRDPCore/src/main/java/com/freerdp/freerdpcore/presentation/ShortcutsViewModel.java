/*
   ViewModel for ShortcutsActivity

*/

package com.freerdp.freerdpcore.presentation;

import android.app.Application;

import androidx.annotation.NonNull;
import androidx.lifecycle.AndroidViewModel;
import androidx.lifecycle.LiveData;
import androidx.lifecycle.MutableLiveData;

import com.freerdp.freerdpcore.data.AppDatabase;
import com.freerdp.freerdpcore.domain.BookmarkBase;
import com.freerdp.freerdpcore.services.ManualBookmarkGateway;

import java.util.Collections;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class ShortcutsViewModel extends AndroidViewModel
{
	private final MutableLiveData<List<BookmarkBase>> bookmarks =
	    new MutableLiveData<>(Collections.emptyList());
	private final ExecutorService executor = Executors.newSingleThreadExecutor();
	private final ManualBookmarkGateway manualBookmarkGateway;

	public ShortcutsViewModel(@NonNull Application application)
	{
		super(application);
		manualBookmarkGateway =
		    new ManualBookmarkGateway(AppDatabase.getInstance(application).bookmarkDao());
	}

	public LiveData<List<BookmarkBase>> getBookmarks()
	{
		return bookmarks;
	}

	public void loadBookmarks()
	{
		executor.execute(() -> bookmarks.postValue(manualBookmarkGateway.findAll()));
	}

	@Override protected void onCleared()
	{
		super.onCleared();
		executor.shutdown();
	}
}
